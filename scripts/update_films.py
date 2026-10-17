"""Manually integrate one trusted, append-only daily film PR. Never run PR code."""
import base64
import datetime as dt
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DAILY_BRANCH = re.compile(r'daily-(\d{4}-\d{2}-\d{2})$')
TRUSTED_CONTRIBUTORS = {'adibrill-instinct'}


class UpdateError(Exception):
    pass


class GitHub:
    def __init__(self, repository, token):
        self.repository = repository
        self.token = token

    def api(self, path, method='GET', data=None):
        request = Request('https://api.github.com/' + path, method=method,
                          data=json.dumps(data).encode() if data is not None else None,
                          headers={'Authorization': 'Bearer ' + self.token,
                                   'Accept': 'application/vnd.github+json',
                                   'X-GitHub-Api-Version': '2022-11-28',
                                   'Content-Type': 'application/json'})
        try:
            with urlopen(request, timeout=45) as response:
                return json.load(response)
        except HTTPError as error:
            # Do not log headers, tokens or untrusted response bodies.
            raise UpdateError(f'GitHub החזיר שגיאה {error.code} בפעולה {method} {path.split("?")[0]}. לא נעשה ניסיון לעקוף הרשאות או כללי מיזוג.') from error

    def repo(self, suffix, **kwargs):
        return self.api(f'repos/{self.repository}/{suffix}', **kwargs)

    def main_sha(self):
        return self.repo('git/ref/heads/main')['object']['sha']

    def films(self, repository, sha):
        result = self.api(f'repos/{repository}/contents/films.json?' + urlencode({'ref': sha}))
        if result.get('encoding') != 'base64' or result.get('size', 0) > 5_000_000:
            raise UpdateError('לא ניתן לקרוא את קובץ הסרטים בבטחה.')
        return json.loads(base64.b64decode(result['content'], validate=False))

    def open_prs(self):
        results = []
        for page in range(1, 11):
            batch = self.repo(f'pulls?state=open&base=main&sort=created&direction=desc&per_page=100&page={page}')
            results.extend(batch)
            if len(batch) < 100:
                return results
        raise UpdateError('יש יותר מדי בקשות פתוחות. נדרשת בדיקה ידנית.')


def trusted_daily(pr, repository):
    owner = repository.split('/')[0].lower()
    allowed = TRUSTED_CONTRIBUTORS | {owner}
    head_repo = pr.get('head', {}).get('repo') or {}
    return (pr.get('state') == 'open' and not pr.get('draft')
            and pr.get('base', {}).get('ref') == 'main'
            and pr.get('base', {}).get('repo', {}).get('full_name', '').lower() == repository.lower()
            and pr.get('user', {}).get('login', '').lower() in allowed
            and head_repo.get('owner', {}).get('login', '').lower() in allowed
            and head_repo.get('name', '').lower() == repository.split('/')[1].lower()
            and bool(DAILY_BRANCH.fullmatch(pr.get('head', {}).get('ref', ''))))


def select_pr(prs, repository):
    candidates = [pr for pr in prs if trusted_daily(pr, repository)]
    return max(candidates, key=lambda pr: (pr['created_at'], pr['number']), default=None)


def validate_batch(old, new, branch, today=None):
    if not isinstance(old, list) or not isinstance(new, list) or not old:
        raise UpdateError('מבנה קובץ הסרטים אינו תקין.')
    if len(new) <= len(old) or new[:len(old)] != old:
        raise UpdateError('ה־PR אינו רק תוספת: סרטים קיימים שונו, הוסרו או סודרו מחדש. נדרשת בדיקה ידנית.')
    match = DAILY_BRANCH.fullmatch(branch)
    if not match:
        raise UpdateError('שם הענף אינו של תוספת יומית.')
    batch_date = dt.date.fromisoformat(match[1])
    today = today or dt.datetime.now(ZoneInfo('Asia/Jerusalem')).date()
    if batch_date > today or batch_date.isoformat() <= max(film['added'] for film in old):
        raise UpdateError('תאריך התוספת חייב להיות חדש מהתוספת הקיימת ולא בעתיד.')
    additions = new[len(old):]
    if any(film.get('added') != batch_date.isoformat() for film in additions):
        raise UpdateError('כל הסרטים החדשים חייבים להיות משויכים לתאריך התוספת.')
    # Run only the validator from trusted main; the PR contributes JSON, not code.
    with tempfile.TemporaryDirectory() as directory:
        folder = Path(directory)
        shutil.copyfile(ROOT / 'validate.py', folder / 'validate.py')
        (folder / 'films.json').write_text(json.dumps(new, ensure_ascii=False))
        result = subprocess.run([sys.executable, str(folder / 'validate.py')],
                                capture_output=True, text=True, timeout=30)
        if result.returncode:
            raise UpdateError('בדיקת הנתונים נכשלה: מזהים, קישורים, קטגוריות, תאריכים או משכי סרטים אינם תקינים.')
    return additions


def review(github, pr, base_sha):
    if not trusted_daily(pr, github.repository):
        raise UpdateError('ה־PR כבר אינו פתוח או אינו מגיע ממקור הסרטים המוכר.')
    files = github.repo(f'pulls/{pr["number"]}/files?per_page=100')
    if len(files) != 1 or files[0]['filename'] != 'films.json' or files[0]['status'] != 'modified':
        raise UpdateError('ה־PR משנה קבצים מעבר לרשימת הסרטים. נדרשת בדיקה ידנית.')
    old = github.films(github.repository, base_sha)
    new = github.films(pr['head']['repo']['full_name'], pr['head']['sha'])
    return validate_batch(old, new, pr['head']['ref'])


def summary(message):
    print(message)
    if path := os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(path, 'a') as stream:
            stream.write(message + '\n\n')


def publish(github, sha):
    # GITHUB_TOKEN merges do not trigger Pages automatically. Request it explicitly.
    github.repo('pages/builds', method='POST', data={})
    for _ in range(24):
        build = github.repo('pages/builds/latest')
        if build.get('commit') == sha:
            if build['status'] == 'built':
                summary('הפרסום הושלם: https://adibrill1.github.io/Ai.Brill.Movies/#new')
                return
            if build['status'] == 'errored':
                raise UpdateError('הסרטים מוזגו, אך פרסום האתר נכשל. אפשר להפעיל שוב כדי לנסות לפרסם מחדש.')
        time.sleep(10)
    raise UpdateError('בקשת הפרסום נשלחה אך טרם אושרה השלמתה. אפשר לבדוק את Pages או להפעיל שוב; הסרטים לא יתווספו פעמיים.')


def update(github, preview=False):
    base_sha = github.main_sha()
    candidate = select_pr(github.open_prs(), github.repository)
    if candidate is None:
        summary('אין PR חדש של סרטים להוספה. האוסף לא השתנה.')
        if not preview:
            latest = github.repo('pages/builds/latest')
            if latest.get('commit') != base_sha or latest.get('status') != 'built':
                publish(github, base_sha)
        return
    pr = github.repo(f'pulls/{candidate["number"]}')
    additions = review(github, pr, base_sha)
    number, head_sha = pr['number'], pr['head']['sha']
    summary(f'PR #{number}: נמצאו {len(additions)} סרטים חדשים. הסרטים הקיימים והקטגוריות שלהם נשמרים.')
    if preview:
        summary('בדיקה בלבד הסתיימה בהצלחה. לא בוצעו מיזוג או פרסום.')
        return
    if github.main_sha() != base_sha:
        raise UpdateError('האוסף השתנה במהלך הבדיקה. הפעילי שוב כדי לבדוק מול הגרסה העדכנית.')
    result = github.repo(f'pulls/{number}/merge', method='PUT',
                         data={'sha': head_sha, 'merge_method': 'merge'})
    if not result.get('merged'):
        raise UpdateError('GitHub לא אישר את המיזוג. יש לבדוק את מצב ה־PR.')
    summary(f'PR #{number} מוזג. לשונית ״חדש״ מציגה את התוספת החדשה; הסרטים הקודמים נשארים בקטגוריותיהם.')
    publish(github, result['sha'])


if __name__ == '__main__':
    try:
        update(GitHub(os.environ['GITHUB_REPOSITORY'], os.environ['GH_TOKEN']),
               preview=os.environ.get('PREVIEW_ONLY') == 'true')
    except Exception as error:
        summary(f'הפעולה נעצרה: {error}')
        sys.exit(1)
