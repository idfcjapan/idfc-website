(() => {
  'use strict';
  if (!window.gsap || !window.ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);
  const media = gsap.matchMedia();
  const home = document.querySelector('.home');
  const language = document.documentElement.lang === 'en';

  media.add('(prefers-reduced-motion: no-preference)', () => {
    const title = document.querySelector('.hero h1 > span');
    if (title) {
      const accessibleTitle = document.createElement('span');
      accessibleTitle.className = 'motion-sr';
      accessibleTitle.textContent = 'IDFC';
      const letters = [...'IDFC'].map(char => {
        const span = document.createElement('span');
        span.className = 'kinetic-letter';
        span.setAttribute('aria-hidden', 'true');
        span.textContent = char;
        return span;
      });
      title.replaceChildren(accessibleTitle, ...letters);
      gsap.from(letters, { yPercent: 24, rotation: 4, opacity: 0, stagger: 0.07, duration: 0.8, ease: 'power3.out', clearProps: 'transform,opacity' });
    }
    const headings = gsap.utils.toArray('.section-heading h2, .page-masthead h1, .home-social h2');
    headings.forEach(heading => gsap.from(heading, { y: 22, duration: 0.7, ease: 'power3.out', clearProps: 'transform,opacity', scrollTrigger: { trigger: heading, start: 'top 92%', once: true } }));
    const cards = gsap.utils.toArray('.voice-grid>.feature-link, .home-photo-preview>.event-photo');
    cards.forEach((card, index) => {
      card.classList.add('motion-managed');
      gsap.from(card, { y: 28, duration: 0.7, delay: (index % 3) * 0.07, ease: 'power3.out', clearProps: 'transform,opacity', scrollTrigger: { trigger: card, start: 'top 95%', once: true } });
    });
    return () => {
      cards.forEach(card => card.classList.remove('motion-managed'));
      if (title) { title.textContent = 'IDFC'; title.removeAttribute('aria-label'); }
    };
  });

  media.add('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)', () => {
    const cursor = document.createElement('div');
    cursor.className = 'motion-cursor';
    cursor.textContent = language ? 'View' : '見る';
    cursor.setAttribute('aria-hidden', 'true');
    document.body.append(cursor);
    const moveX = gsap.quickTo(cursor, 'x', { duration: 0.16, ease: 'power3.out' });
    const moveY = gsap.quickTo(cursor, 'y', { duration: 0.16, ease: 'power3.out' });
    const enter = () => gsap.set(cursor, { autoAlpha: 1 });
    const leave = () => gsap.set(cursor, { autoAlpha: 0 });
    const move = event => { moveX(event.clientX); moveY(event.clientY); };
    const photos = [...document.querySelectorAll('a[data-lightbox]')];
    photos.forEach(photo => { photo.addEventListener('pointerenter', enter); photo.addEventListener('pointerleave', leave); });
    document.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('blur', leave);
    document.addEventListener('scroll', leave, { passive: true });
    document.addEventListener('pointerdown', leave);
    const actions = [...document.querySelectorAll('.button:not(.contact-button)')];
    const actionHandlers = actions.map(button => {
      const x = gsap.quickTo(button, 'x', { duration: 0.25, ease: 'power3.out' });
      const y = gsap.quickTo(button, 'y', { duration: 0.25, ease: 'power3.out' });
      const reset = () => { x(0); y(0); };
      const handle = event => { if (event.pointerType === 'touch') { reset(); return; } const box = button.getBoundingClientRect(); x(Math.max(-4, Math.min(4, (event.clientX - box.left - box.width/2) * .06))); y(Math.max(-4, Math.min(4, (event.clientY - box.top - box.height/2) * .06))); };
      button.addEventListener('pointermove', handle);
      ['pointerleave', 'pointerdown', 'pointercancel', 'click', 'blur'].forEach(type => button.addEventListener(type, reset));
      window.addEventListener('blur', reset);
      window.addEventListener('pagehide', reset);
      return { button, handle, reset };
    });
    const tiltTarget = document.querySelector('.hero-visual>.hero-photo');
    const tilt = event => { if (!tiltTarget) return; const box = tiltTarget.getBoundingClientRect(); gsap.to(tiltTarget, { rotationY: Math.max(-4, Math.min(4, (event.clientX-box.left)/box.width*8-4)), rotationX: Math.max(-4, Math.min(4, -((event.clientY-box.top)/box.height*8-4))), duration: .5, overwrite: 'auto', ease: 'power2.out' }); };
    const untilt = () => { if (tiltTarget) gsap.to(tiltTarget, { rotationX: 0, rotationY: 0, duration: .5, overwrite: 'auto' }); };
    tiltTarget?.addEventListener('pointermove', tilt); tiltTarget?.addEventListener('pointerleave', untilt);
    return () => {
      photos.forEach(photo => { photo.removeEventListener('pointerenter', enter); photo.removeEventListener('pointerleave', leave); });
      document.removeEventListener('pointermove', move); window.removeEventListener('blur', leave); document.removeEventListener('scroll', leave); document.removeEventListener('pointerdown', leave);
      actionHandlers.forEach(({ button, handle, reset }) => {
        button.removeEventListener('pointermove', handle);
        ['pointerleave', 'pointerdown', 'pointercancel', 'click', 'blur'].forEach(type => button.removeEventListener(type, reset));
        window.removeEventListener('blur', reset);
        window.removeEventListener('pagehide', reset);
        gsap.killTweensOf(button);
        gsap.set(button, { clearProps: 'transform' });
      });
      tiltTarget?.removeEventListener('pointermove', tilt); tiltTarget?.removeEventListener('pointerleave', untilt);
      if (tiltTarget) { gsap.killTweensOf(tiltTarget); gsap.set(tiltTarget, { clearProps: 'transform' }); }
      cursor.remove();
    };
  });
  const refresh = () => ScrollTrigger.refresh();
  window.addEventListener('load', refresh, { once: true });
  if (document.fonts) document.fonts.ready.then(refresh);
  if (home) home.querySelectorAll('img').forEach(img => { if (!img.complete) img.addEventListener('load', refresh, { once: true }); });
})();
