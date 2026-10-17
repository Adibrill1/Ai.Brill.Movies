"""Run with: python3 -m unittest discover -s tests -p 'test_*.py'."""
import copy
import datetime as dt
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('update_films', Path(__file__).resolve().parents[1] / 'scripts/update_films.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
REPO = 'Adibrill1/Ai.Brill.Movies'
OLD = json.loads((m.ROOT / 'films.json').read_text())
DATE = (dt.date.fromisoformat(max(f['added'] for f in OLD)) + dt.timedelta(days=1)).isoformat()
NEW = copy.deepcopy(OLD)
NEW.append(dict(OLD[0], id='test-new', title='Test addition', added=DATE,
                watchUrl='https://www.youtube.com/watch?v=abcdefghijk'))
PR = {'number': 99, 'created_at': DATE + 'T04:00:00Z', 'state': 'open', 'draft': False,
      'user': {'login': 'adibrill-instinct'},
      'base': {'ref': 'main', 'repo': {'full_name': REPO}},
      'head': {'ref': 'daily-' + DATE, 'sha': 'head-sha',
               'repo': {'full_name': 'adibrill-instinct/Ai.Brill.Movies', 'name': 'Ai.Brill.Movies',
                        'owner': {'login': 'adibrill-instinct'}}}}


class FakeGitHub:
    repository = REPO

    def __init__(self):
        self.prs = [copy.deepcopy(PR)]
        self.files = [{'filename': 'films.json', 'status': 'modified'}]
        self.base_reads = 0
        self.main_changed = False
        self.merge_succeeds = True
        self.writes = []
        self.build_status = 'built'

    def main_sha(self):
        self.base_reads += 1
        return 'moved-main' if self.main_changed and self.base_reads > 1 else 'base-sha'

    def open_prs(self):
        return self.prs

    def films(self, repository, sha):
        return copy.deepcopy(OLD if sha == 'base-sha' else NEW)

    def repo(self, suffix, method='GET', data=None):
        if method != 'GET':
            self.writes.append((suffix, method, data))
        if suffix == 'pulls/99':
            return self.prs[0]
        if suffix.startswith('pulls/99/files'):
            return self.files
        if suffix == 'pulls/99/merge':
            return {'merged': self.merge_succeeds, 'sha': 'merged-sha'}
        if suffix == 'pages/builds':
            return {'status': 'queued'}
        if suffix == 'pages/builds/latest':
            return {'status': self.build_status, 'commit': 'merged-sha' if self.prs else 'base-sha'}
        raise AssertionError(suffix)


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.summary = patch.object(m, 'summary').start()
        self.sleep = patch.object(m.time, 'sleep').start()
        self.addCleanup(patch.stopall)

    def validate(self, new):
        return m.validate_batch(OLD, new, 'daily-' + DATE, today=dt.date.fromisoformat(DATE))

    def test_append_only_batch(self):
        self.assertEqual(len(self.validate(NEW)), 1)

    def test_reject_existing_edits_removal_and_reorder(self):
        changed = copy.deepcopy(NEW)
        changed[0]['title'] = 'Overwritten'
        for bad in [changed, NEW[1:], [NEW[1], NEW[0], *NEW[2:]], OLD]:
            with self.subTest(), self.assertRaises(m.UpdateError):
                self.validate(bad)

    def test_reject_bad_ids_links_categories_durations_and_dates(self):
        for field, value in [('id', OLD[0]['id']), ('watchUrl', OLD[0]['watchUrl']),
                             ('category', 'unknown'), ('durationSeconds', -1),
                             ('added', OLD[0]['added']), ('watchUrl', 'javascript:alert(1)')]:
            bad = copy.deepcopy(NEW)
            bad[-1][field] = value
            with self.subTest(field=field), self.assertRaises(m.UpdateError):
                self.validate(bad)
        with self.assertRaises(m.UpdateError):
            m.validate_batch(OLD, NEW, 'daily-' + DATE, today=dt.date(2000, 1, 1))

    def test_only_trusted_daily_prs(self):
        for field, value in [('draft', True), ('state', 'closed'), ('user', {'login': 'unknown'})]:
            bad = copy.deepcopy(PR)
            bad[field] = value
            self.assertIsNone(m.select_pr([bad], REPO))
        bad = copy.deepcopy(PR)
        bad['head']['repo']['owner']['login'] = 'unknown'
        self.assertIsNone(m.select_pr([bad], REPO))
        bad = copy.deepcopy(PR)
        bad['head']['ref'] = 'feature-redesign'
        self.assertIsNone(m.select_pr([bad], REPO))
        older = dict(PR, number=98, created_at='2000-01-01T00:00:00Z')
        self.assertEqual(m.select_pr([older, PR], REPO)['number'], 99)

    def test_preview_never_writes(self):
        github = FakeGitHub()
        with patch.object(m, 'validate_batch', return_value=[NEW[-1]]):
            m.update(github, preview=True)
        self.assertEqual(github.writes, [])

    def test_no_pr_is_noop_when_site_is_current(self):
        github = FakeGitHub()
        github.prs = []
        m.update(github)
        self.assertEqual(github.writes, [])
        m.update(github, preview=True)
        self.assertEqual(github.writes, [])

    def test_no_pr_can_retry_failed_publication(self):
        github = FakeGitHub()
        github.prs = []
        github.build_status = 'errored'
        with patch.object(m, 'publish') as publish:
            m.update(github)
            publish.assert_called_once_with(github, 'base-sha')

    def test_code_changes_stop_before_merge(self):
        github = FakeGitHub()
        github.files.append({'filename': '.github/workflows/attack.yml', 'status': 'added'})
        with self.assertRaises(m.UpdateError):
            m.update(github)
        self.assertEqual(github.writes, [])

    def test_main_movement_stops_merge(self):
        github = FakeGitHub()
        github.main_changed = True
        with patch.object(m, 'validate_batch', return_value=[NEW[-1]]), self.assertRaises(m.UpdateError):
            m.update(github)
        self.assertEqual(github.writes, [])

    def test_exact_head_merge_and_explicit_pages_build(self):
        github = FakeGitHub()
        with patch.object(m, 'validate_batch', return_value=[NEW[-1]]):
            m.update(github)
        self.assertEqual(github.writes, [('pulls/99/merge', 'PUT', {'sha': 'head-sha', 'merge_method': 'merge'}),
                                         ('pages/builds', 'POST', {})])

    def test_merge_rejection_does_not_publish(self):
        github = FakeGitHub()
        github.merge_succeeds = False
        with patch.object(m, 'validate_batch', return_value=[NEW[-1]]), self.assertRaises(m.UpdateError):
            m.update(github)
        self.assertEqual(len(github.writes), 1)

    def test_publication_failure_and_timeout_are_reported(self):
        for status in ['errored', 'building']:
            github = FakeGitHub()
            github.build_status = status
            with self.subTest(status=status), self.assertRaises(m.UpdateError):
                m.publish(github, 'merged-sha')


if __name__ == '__main__':
    unittest.main()
