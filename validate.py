"""Validate the library without external dependencies."""
import json, pathlib, datetime
from urllib.parse import urlparse
root = pathlib.Path(__file__).parent
films = json.loads((root / 'films.json').read_text())
ids, urls = set(), set()
for film in films:
    for key in ('id', 'title', 'creator', 'added', 'category', 'description', 'watchUrl', 'sourceUrl'):
        assert isinstance(film[key], str) and film[key].strip(), (film.get('id'), key)
    assert film['id'] not in ids, 'Duplicate id'
    assert film['watchUrl'] not in urls, 'Duplicate watch link'
    ids.add(film['id']); urls.add(film['watchUrl'])
    datetime.date.fromisoformat(film['added'])
    assert film['category'] in ('פסטיבל', 'קהילה', 'הדגמה רשמית')
    assert film['tools'] is None or isinstance(film['tools'], str)
    for key in ('watchUrl', 'sourceUrl'):
        parsed = urlparse(film[key]); assert parsed.scheme == 'https' and parsed.netloc
    if film.get('poster'): assert film['poster'].startswith(('https://', 'data:image/jpeg;base64,'))
print(f'OK: {len(films)} films, unique IDs and watch links, valid dates, URLs and local posters.')
