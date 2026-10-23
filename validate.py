"""Validate the library without external dependencies."""
import json, pathlib, datetime, re
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
    assert film['category'] in ('סרטים', 'איך', 'הדגמה רשמית', 'חדש', 'מעבדת ויז׳ואל', 'Adi')
    assert film['tools'] is None or isinstance(film['tools'], str)
    for key in ('watchUrl', 'sourceUrl'):
        # the Adi chapter may link to this computer (file:// or a local server on 127.0.0.1); every other link must be https
        if key == 'watchUrl' and film['category'] == 'Adi':
            if film[key].startswith('file:///'): continue
            parsed_local = urlparse(film[key])
            if parsed_local.scheme == 'http' and parsed_local.hostname in ('127.0.0.1', 'localhost'): continue
        parsed = urlparse(film[key]); assert parsed.scheme == 'https' and parsed.netloc
    if film.get('poster'): assert film['poster'].startswith(('https://', 'data:image/jpeg;base64,'))
    duration = film.get('durationSeconds')
    assert duration is None or (type(duration) is int and 0 < duration < 86400), (film['id'], 'durationSeconds')
    if film.get('durationSource'):
        parsed = urlparse(film['durationSource']); assert parsed.scheme == 'https' and parsed.netloc
    for field in ('createdDate', 'publishedDate'):
        value = film.get(field)
        if value is not None:
            assert isinstance(value, str) and re.fullmatch(r'[1-9]\d{3}(?:-\d{2}(?:-\d{2})?)?', value), (film['id'], field)
            full = value + ('-01-01' if len(value) == 4 else '-01' if len(value) == 7 else '')
            datetime.date.fromisoformat(full)
            source = urlparse(film.get(field + 'Source', ''))
            assert source.scheme == 'https' and source.netloc, (film['id'], field + 'Source')
    if film.get('posterFallback'):
        parsed = urlparse(film['posterFallback']); assert parsed.scheme == 'https' and parsed.netloc
    if 'posterOptions' in film:
        assert isinstance(film['posterOptions'], list), (film['id'], 'posterOptions')
        image_urls = set()
        for option in film['posterOptions']:
            assert isinstance(option['label'], str) and option['label'].strip(), (film['id'], 'image label')
            for field in ('src', 'sourceUrl'):
                parsed = urlparse(option[field])
                assert parsed.scheme == 'https' and parsed.netloc and not parsed.username and not parsed.password, (film['id'], field)
            assert option['src'] not in image_urls, (film['id'], 'Duplicate image option')
            image_urls.add(option['src'])
known_durations = sum(film.get('durationSeconds') is not None for film in films)
print(f'OK: {len(films)} films, unique IDs and watch links, valid dates, URLs and images; {known_durations} film durations supplied.')
