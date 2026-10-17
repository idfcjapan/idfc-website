"""Accessible, dependency-free SVG charts for documented IDFC counts."""
from html import escape
import math

COLORS = ('#234e70', '#4c9ad2', '#3fb5ad', '#8b8cdc', '#bfd9ef')


def chart(ident, title, values, note=''):
    if not values or len(values) > len(COLORS) or any(value <= 0 for _, value in values):
        raise ValueError('Pie charts require positive counts and a complete breakdown.')
    total = sum(value for _, value in values)
    angle = -math.pi / 2
    slices, legend = [], []
    for index, (label, value) in enumerate(values):
        end = angle + value / total * math.tau
        x1, y1 = 100 + 90 * math.cos(angle), 100 + 90 * math.sin(angle)
        x2, y2 = 100 + 90 * math.cos(end), 100 + 90 * math.sin(end)
        large = int(value / total > .5)
        if value == total:
            segment = '<circle cx="100" cy="100" r="90"'
        else:
            segment = f'<path d="M 100 100 L {x1:.6f} {y1:.6f} A 90 90 0 {large} 1 {x2:.6f} {y2:.6f} Z"'
        slices.append(segment + f' fill="{COLORS[index]}" stroke="white" stroke-width="1.5" data-pie-value="{value}"/>')
        legend.append(f'<li><span class="pie-swatch pie-color-{index}" aria-hidden="true"></span>'
                      f'<span class="pie-label">{escape(label)}</span><span class="pie-value">'
                      f'<strong>{value}</strong><span>名</span><small>{value / total * 100:.1f}%</small></span></li>')
        angle = end
    return (f'<figure class="pie-chart" data-pie-chart="{escape(ident)}" data-pie-total="{total}">'
            f'<figcaption><h3>{escape(title)}</h3><p class="pie-total"><span>合計</span> '
            f'<strong>{total}</strong><span>名</span></p></figcaption>'
            '<div class="pie-body"><svg class="pie-visual" viewBox="0 0 200 200" '
            'width="200" height="200" aria-hidden="true" focusable="false">' + ''.join(slices) +
            '</svg><ul class="pie-legend">' + ''.join(legend) + '</ul></div>' +
            (f'<p class="chart-note pie-note">{escape(note)}</p>' if note else '') + '</figure>')


def conference_2026():
    return '<div class="pie-grid">' + \
        chart('participants-2026', '参加者の内訳', [('日本', 10), ('ミャンマー', 12)]) + \
        chart('committees-2026', '運営委員の内訳', [('日本', 6), ('ミャンマー', 5)]) + '</div>'


def plan_2027():
    return ('<section class="participant-plan" data-participant-plan="plan-2027" data-participant-total="36">'
            '<h3>参加人数の計画</h3><dl class="participant-counts">'
            '<div><dt>日本</dt><dd><strong data-participant-count="18">18</strong><span>名</span></dd></div>'
            '<div><dt>ミャンマー</dt><dd><strong data-participant-count="18">18</strong><span>名</span></dd></div>'
            '<div class="participant-count-total"><dt>合計</dt><dd><strong>36</strong><span>名</span></dd></div>'
            '</dl></section>')


def diversity():
    return '<div class="pie-grid">' + \
        chart('gender-2027', '男女比', [('女性', 12), ('男性', 6)]) + \
        chart('study-2027', '文系・理系', [('文系', 13), ('理系', 5)]) + \
        chart('region-2027', '地域', [('関東', 11), ('愛知', 1), ('富山', 1), ('大阪', 3), ('北米', 2)]) + \
        chart('specialty-2027', '専門分野', [('国際系', 6), ('経済・商学系', 4), ('医薬系', 4), ('法・政治系／情報・芸術系', 4)],
              '法・政治系／情報・芸術系は合算です。個別人数は資料に記載がないため、18名から他の3分野の14名を除いた4名を表示しています。') + '</div>'
