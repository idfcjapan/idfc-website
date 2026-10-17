"""Presentation layers for the bilingual IDFC site."""
import hashlib
from pathlib import Path
import photos_2026

ROOT = Path(__file__).resolve().parents[1]

def assets():
    files = ['assets/css/design.css', 'assets/js/motion.js']
    version = hashlib.sha256(b''.join((ROOT/'site'/f).read_bytes() for f in files)).hexdigest()[:12]
    return f'''<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&amp;family=Noto+Serif+JP:wght@500;600&amp;family=Space+Grotesk:wght@500;600;700&amp;display=swap">
<link rel="stylesheet" href="/assets/css/design.css?v={version}">
<script src="/assets/vendor/gsap.min.js" defer></script><script src="/assets/vendor/ScrollTrigger.min.js" defer></script><script src="/assets/js/motion.js?v={version}" defer></script>'''

def hero_background():
    return '<div class="hero-background" aria-hidden="true"><img class="hero-scene scene-one" src="/assets/idfc2026/group-outdoors.webp" alt="" width="1536" height="1024" fetchpriority="high" decoding="async"><img class="hero-scene scene-two" src="/assets/idfc2026/cultural-sharing.webp" alt="" width="2048" height="1365" decoding="async"></div>'

def story():
    return '''<section class="connection-story" id="connection-story" aria-labelledby="connection-title">
<div class="connection-orbit" aria-hidden="true"></div><div class="wrap connection-inner">
<p class="story-label">IDFC2026</p><h2 id="connection-title"><span>出会いが、</span><span>未来をつなぐ。</span></h2>
<div class="connection-photos">'''+\
        photos_2026.photo('session-wide', 'story-left', caption='ともに学ぶ', sizes='(max-width:900px) 90vw, 28vw')+\
        photos_2026.photo('group-outdoors', 'story-center', caption='出会いを次の一歩へ', sizes='(max-width:900px) 90vw, 35vw')+\
        photos_2026.photo('cultural-sharing', 'story-right', caption='文化を分かち合う', sizes='(max-width:900px) 90vw, 28vw')+\
        '</div><a class="story-link" href="'+photos_2026.ROUTE+'#photos-2026">IDFC2026の写真をすべて見る →</a></div></section>'
