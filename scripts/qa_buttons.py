"""Audit every generated control and the shared hover/selected-state styles.

This checks HTML and CSS contracts. It does not simulate browser rendering.
"""
import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import unquote, urlsplit
from lxml import html

ROOT = Path(__file__).resolve().parents[1]
checks = 0


def check(condition, message):
    global checks
    assert condition, message
    checks += 1


def css_rules(source, conditions=()):
    source = re.sub(r'/\*.*?\*/', '', source, flags=re.S)
    source = re.sub(r'@charset\s+[^;]+;', '', source)
    position = 0
    while (opening := source.find('{', position)) >= 0:
        selector = source[position:opening].strip()
        depth = 1
        quote = None
        closing = opening + 1
        while closing < len(source) and depth:
            char = source[closing]
            if quote:
                if char == '\\':
                    closing += 2
                    continue
                if char == quote:
                    quote = None
            elif char in ('"', "'"):
                quote = char
            elif char == '{':
                depth += 1
            elif char == '}':
                depth -= 1
            closing += 1
        check(depth == 0, 'CSS blocks must be balanced')
        body = source[opening + 1:closing - 1]
        if selector.startswith('@media'):
            yield from css_rules(body, conditions + (selector,))
        elif selector.startswith('@supports') or selector.startswith('@layer'):
            yield from css_rules(body, conditions)
        elif not selector.startswith('@'):
            declarations = {}
            for declaration in body.split(';'):
                key, separator, value = declaration.partition(':')
                if separator:
                    declarations[key.strip()] = value.strip()
            yield selector, declarations, conditions
        position = closing


styles = []
for filename in ('site.css', 'design.css'):
    styles.extend(css_rules((ROOT / 'site/assets/css' / filename).read_text()))
hover_rules = 0
variables = {}
for selector, declarations, conditions in styles:
    if selector == ':root':
        variables.update(declarations)
    if ':hover' in selector:
        hover_rules += 1
        media = ''.join(conditions).replace(' ', '')
        check('(hover:hover)' in media and '(pointer:fine)' in media,
              'Hover effects must not apply to touch-only devices: ' + selector)
    if '[aria-current' in selector or '.is-current' in selector:
        for property_name in ('color', 'background', 'border-color', 'border-bottom'):
            check('var(--red)' not in declarations.get(property_name, ''),
                  'Selected links must not be locked red: ' + selector)
check(any('a:focus-visible' in selector and 'outline' in props and not conditions
          for selector, props, conditions in styles),
      'Keyboard focus must remain visible independently of hover support')


def state_styles(selector):
    result = {}
    for group, declarations, conditions in styles:
        if not conditions and selector in [item.strip() for item in group.split(',')]:
            result.update(declarations)
    return result


def color(value):
    if value.startswith('var('):
        value = variables[value[4:-1]]
    if value == 'white':
        value = '#ffffff'
    value = value.lstrip('#')
    if len(value) == 3:
        value = ''.join(char * 2 for char in value)
    check(len(value) == 6, 'State color must resolve to an opaque RGB color')
    components = [int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    linear = [c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in components]
    return sum(c * weight for c, weight in zip(linear, (.2126, .7152, .0722)))


contrasts = {}
for selector in ('.update-nav a[aria-current=page]', '.year-nav a[aria-current=page]',
                 '.header-links>a[aria-current=page]', '.language-switch a[aria-current=page]'):
    state = state_styles(selector)
    foreground = color(state['color'])
    background = color(state.get('background', 'var(--paper)'))
    contrast = (max(foreground, background) + .05) / (min(foreground, background) + .05)
    check(contrast >= 4.5, 'Selected control text must remain readable: ' + selector)
    contrasts[selector] = round(contrast, 2)

buttons = Counter()
anchors = 0
disabled = Counter()
files = sorted((ROOT / 'site').rglob('*.html'))
for path in files:
    route = '/' if path.parent == ROOT / 'site' else '/' + str(path.parent.relative_to(ROOT / 'site')) + '/'
    page = html.parse(str(path))
    for control in page.xpath('//button|//input[@type="button" or @type="submit"]|//*[@role="button"]'):
        name = control.get('aria-label') or control.get('title') or control.get('value') or ''.join(control.itertext()).strip()
        if control.get('aria-labelledby'):
            name = ' '.join(''.join(n.itertext()) for ident in control.get('aria-labelledby').split()
                            for n in page.xpath('//*[@id=$id]', id=ident))
        check(bool(name), route + ': every button needs an accessible name')
        panel = control.get('aria-controls')
        if panel:
            check(len(page.xpath('//*[@id=$id]', id=panel)) == 1, route + ': button panel must exist once')
            if control.get('aria-expanded') is not None:
                check(control.get('aria-expanded') == 'false', route + ': menu starts in its closed state')
        control_type = ('menu' if 'mobile-toggle' in control.get('class', '').split() else
                        'submenu' if 'dropdown-toggle' in control.get('class', '').split() else
                        'photo close' if 'photo-close' in control.get('class', '').split() else
                        'document previous' if control.get('data-document-prev') is not None else
                        'document next' if control.get('data-document-next') is not None else
                        'contact' if control.get('aria-describedby') == 'contact-note' else None)
        check(control_type is not None, route + ': every button has an implemented action')
        buttons[control_type] += 1
        if control.get('disabled') is not None:
            disabled[control_type] += 1
            check(control_type in ('document previous', 'contact'), route + ': disabled state has a documented purpose')
    for link in page.xpath('//a'):
        anchors += 1
        href = link.get('href', '')
        check(bool(href.strip()) and href != '#' and not href.lower().startswith('javascript:'),
              route + ': every link has a real destination')
        name = link.get('aria-label') or link.get('title') or ''.join(link.itertext()).strip() or ' '.join(link.xpath('.//img/@alt'))
        check(bool(name.strip()), route + ': every link needs an accessible name')
        if link.get('target') == '_blank':
            check({'noopener', 'noreferrer'} <= set(link.get('rel', '').split()), route + ': safe external-tab link')
        if link.get('aria-current') == 'page' and urlsplit(href).path:
            check(unquote(urlsplit(href).path) == route, route + ': current-page state points to this page')
    for link in page.xpath('//div[@class="header-links"]/a'):
        current = unquote(urlsplit(link.get('href')).path) == route
        check((link.get('aria-current') == 'page') == current, route + ': sponsor/contact state follows the URL')

result = {
    'result': 'pass', 'assertions': checks, 'pages': len(files), 'buttons': dict(buttons),
    'anchors': anchors, 'hover_rules': hover_rules, 'selected_text_contrast': contrasts,
    'intentional_disabled_controls': dict(disabled), 'rendering_browser_qa': False,
    'scope': 'All generated controls, destinations, current-page states and shared CSS state rules',
}
(ROOT / 'reports/qa-buttons.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(result, ensure_ascii=False))
