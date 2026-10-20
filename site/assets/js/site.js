(async () => {
  'use strict';
  document.documentElement.classList.add('js');
  const scriptURL = document.currentScript?.src;
  if (scriptURL) {
    const analyticsURL = new URL('./analytics.js', scriptURL);
    analyticsURL.search = new URL(scriptURL).search;
    void import(analyticsURL.href).then(module => module.recordPageView()).catch(() => {});
  }
  if (location.origin === 'https://idfcjapan.github.io' && scriptURL) {
    try {
      const moduleURL = new URL('./content-sync.js', scriptURL);
      moduleURL.search = new URL(scriptURL).search;
      await (await import(moduleURL.href)).syncPublishedContent();
    } catch { /* The static publication stays usable without the editor. */ }
  }
  const english = document.documentElement.getAttribute('lang') === 'en';
  const text = english ? {
    menuOpen: 'Open menu', menuClose: 'Close menu', imageFailed: 'The image could not be loaded.',
    originalImage: 'Open original image', imageError: '[Image unavailable] ', originalURL: 'Original image URL'
  } : {
    menuOpen: 'メニューを開く', menuClose: 'メニューを閉じる', imageFailed: '画像を読み込めませんでした。',
    originalImage: '元画像を開く', imageError: '[画像取得失敗・要確認] ', originalURL: '元画像URL'
  };
  document.querySelectorAll('[data-language-link]').forEach(link => {
    const path = link.getAttribute('href');
    const update = () => { link.setAttribute('href', path + window.location.search + window.location.hash); };
    update();
    link.addEventListener('click', update);
    link.addEventListener('pointerdown', update);
    link.addEventListener('focus', update);
    window.addEventListener('hashchange', update);
  });
  const nav = document.querySelector('.primary-nav');
  const mobileButton = document.querySelector('.mobile-toggle');
  const header = document.querySelector('.site-header');
  const compactMenu = window.matchMedia('(max-width: 1199px)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  // Keep the language switch within reach without adding a second header row.
  // The existing support links remain available at the start of the menu.
  const supportLinks = header?.querySelector('.header-links');
  const supportParent = supportLinks?.parentElement;
  const supportNext = supportLinks?.nextSibling;
  const menuContent = nav?.querySelector('.wrap');
  const syncSupportLinks = () => {
    if (!supportLinks || !supportParent || !menuContent) return;
    if (compactMenu.matches) {
      if (supportLinks.parentElement !== menuContent) menuContent.prepend(supportLinks);
    } else if (supportLinks.parentElement !== supportParent) {
      supportParent.insertBefore(supportLinks, supportNext);
    }
  };
  syncSupportLinks();
  compactMenu.addEventListener('change', syncSupportLinks);
  // A sticky header stays at the current scroll position, so return to the
  // document origin explicitly, including repeated clicks on the same hash.
  document.querySelectorAll('a.back-top[href="#top"]').forEach(link => {
    link.addEventListener('click', event => {
      if (event.defaultPrevented || event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      window.history.replaceState(window.history.state, '', '#top');
      window.scrollTo({ top: 0, left: 0, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
    });
  });
  const updateMenuHeight = () => {
    if (!nav || !header) return;
    // Absolute positioning starts at the header's padding edge, inside its border.
    const border = parseFloat(window.getComputedStyle(header).borderBottomWidth) || 0;
    const top = Math.max(0, header.getBoundingClientRect().bottom - border);
    const viewportHeight = window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight;
    nav.style.setProperty('--menu-top', `${top}px`);
    nav.style.setProperty('--menu-height', `${Math.max(1, viewportHeight - top)}px`);
  };
  const updateHeaderHeight = () => {
    if (!header) return;
    document.documentElement.style.setProperty('--header-height', `${Math.ceil(header.getBoundingClientRect().height)}px`);
    updateMenuHeight();
  };
  updateHeaderHeight();
  window.addEventListener('resize', updateHeaderHeight);
  window.visualViewport?.addEventListener('resize', updateHeaderHeight);
  window.visualViewport?.addEventListener('scroll', updateMenuHeight, { passive: true });
  if (header && typeof window.ResizeObserver === 'function') {
    new window.ResizeObserver(updateHeaderHeight).observe(header);
  }

  // The year menu scrolls with the page; only the main header is fixed.
  const yearMenu = document.querySelector('.year-section-nav');

  // Enhance the saved publication only after CMS synchronization. Keeping the
  // original chapter elements preserves editor scopes and existing links.
  const profileDisclosures = [];
  const addProfileDisclosure = container => {
    const heading = container.querySelector(':scope > h2');
    if (!heading || container.querySelector(':scope > .profile-disclosure')) return;
    const disclosure = document.createElement('details');
    disclosure.className = 'profile-disclosure';
    const summary = document.createElement('summary');
    const body = document.createElement('div');
    body.className = 'profile-disclosure-body';
    summary.append(heading);
    body.append(...container.childNodes);
    disclosure.append(summary, body);
    container.append(disclosure);
    container.classList.add('has-profile-disclosure');
    profileDisclosures.push(disclosure);
  };
  document.querySelectorAll('#committee-2027, #japan-members-2027, #myanmar-members-2027')
    .forEach(addProfileDisclosure);

  const revealProfileTarget = hash => {
    let target;
    try { target = document.getElementById(decodeURIComponent(hash.slice(1))); } catch { return null; }
    if (!target) return null;
    const own = target.querySelector(':scope > .profile-disclosure');
    if (own) own.open = true;
    let ancestor = target.closest('.profile-disclosure');
    while (ancestor) {
      ancestor.open = true;
      ancestor = ancestor.parentElement?.closest('.profile-disclosure');
    }
    return target;
  };
  if (profileDisclosures.length) {
    const followProfileHash = () => {
      const target = revealProfileTarget(window.location.hash);
      if (target) requestAnimationFrame(() => target.scrollIntoView({ block: 'start', behavior: 'auto' }));
    };
    // Open before the browser performs its normal anchor navigation. This also
    // handles clicking the current hash again after manually closing its chapter.
    document.addEventListener('click', event => {
      if (event.defaultPrevented || event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      let destination;
      try { destination = new URL(link.href, window.location.href); } catch { return; }
      if (destination.origin === location.origin && destination.pathname === location.pathname &&
          destination.search === location.search && destination.hash) revealProfileTarget(destination.hash);
    }, true);
    window.addEventListener('hashchange', followProfileHash);
    followProfileHash();
    const initial = document.querySelector('[data-year-hub]')?.getAttribute('data-initial-section');
    if (!window.location.hash && initial) revealProfileTarget('#' + initial);

    // Native details must be open for reliable printing across browsers. Restore
    // the reader's choices once the print dialog closes.
    let printState;
    const prepareProfilesForPrint = () => {
      if (printState) return;
      printState = profileDisclosures.map(disclosure => disclosure.open);
      profileDisclosures.forEach(disclosure => { disclosure.open = true; });
    };
    const restoreProfilesAfterPrint = () => {
      if (!printState) return;
      profileDisclosures.forEach((disclosure, index) => { disclosure.open = printState[index]; });
      printState = null;
    };
    window.addEventListener('beforeprint', prepareProfilesForPrint);
    window.addEventListener('afterprint', restoreProfilesAfterPrint);
    window.matchMedia('print').addEventListener('change', event => {
      if (event.matches) prepareProfilesForPrint(); else restoreProfilesAfterPrint();
    });
  }

  // Anchor order follows the article, so long sections and individual members
  // remain selected until the reader reaches the next heading.
  const contents = document.querySelector('.article-aside');
  const hub = document.querySelector('[data-year-hub]');
  const tocEntries = contents ? [...contents.querySelectorAll('a')].flatMap(link => {
    const href = link.getAttribute('href') || '';
    if (!href.startsWith('#')) return [];
    let id;
    try { id = decodeURIComponent(href.slice(1)); } catch { return []; }
    const target = document.getElementById(id);
    return target ? [{ link, target }] : [];
  }) : [];
  if (tocEntries.length) {
    const details = contents.querySelector('details');
    if (window.matchMedia('(max-width: 900px)').matches) details?.removeAttribute('open');
    const yearLinks = hub ? [...document.querySelectorAll('[data-year-target]')].filter(link => !contents.contains(link)) : [];
    let activeLink;
    let activeChapter;
    let scheduled = false;
    const syncContents = () => {
      const activation = (header?.getBoundingClientRect().height || 0) + 24;
      let current = tocEntries[0];
      for (const entry of tocEntries) {
        const closed = entry.target.closest('.profile-disclosure:not([open])');
        if (closed && !closed.querySelector(':scope > summary')?.contains(entry.target)) continue;
        if (entry.target.getBoundingClientRect().top > activation + 1) break;
        current = entry;
      }
      if (current.link !== activeLink) {
        tocEntries.forEach(({ link }) => {
          const active = link === current.link;
          if (active) { link.setAttribute('aria-current', 'location'); link.classList.add('is-current'); }
          else { link.removeAttribute('aria-current'); link.classList.remove('is-current'); }
        });
        activeLink = current.link;
        if (details?.open) {
          const box = details.getBoundingClientRect();
          const item = activeLink.getBoundingClientRect();
          if (item.top < box.top + 40 || item.bottom > box.bottom - 12) {
            details.scrollTop += item.top - box.top - Math.max(40, box.height / 2);
          }
        }
      }
      const chapter = current.target.closest('[data-year-section]')?.getAttribute('data-year-section');
      if (chapter && chapter !== activeChapter) {
        yearLinks.forEach(link => {
          if (link.getAttribute('data-year-target') === chapter) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
        contents.querySelectorAll('.toc-group').forEach(group => {
          const active = group.querySelector('[data-year-target]')?.getAttribute('data-year-target') === chapter;
          if (active) group.classList.add('is-active-group'); else group.classList.remove('is-active-group');
        });
        const selected = yearMenu?.querySelector('[aria-current]');
        if (selected && yearMenu.clientWidth) {
          if (selected.offsetLeft < yearMenu.scrollLeft) yearMenu.scrollLeft = selected.offsetLeft;
          else if (selected.offsetLeft + selected.offsetWidth > yearMenu.scrollLeft + yearMenu.clientWidth) {
            yearMenu.scrollLeft = selected.offsetLeft + selected.offsetWidth - yearMenu.clientWidth;
          }
        }
        activeChapter = chapter;
      }
    };
    const queueContents = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; syncContents(); });
    };
    window.addEventListener('scroll', queueContents, { passive: true });
    window.addEventListener('resize', queueContents);
    window.addEventListener('hashchange', queueContents);
    window.addEventListener('pageshow', queueContents);
    document.addEventListener('toggle', queueContents, true);
    const alignInitialSection = () => {
      let target = revealProfileTarget(window.location.hash);
      const initial = hub?.getAttribute('data-initial-section');
      if (!window.location.hash && initial && initial !== 'overview-2027') target = revealProfileTarget('#' + initial);
      target?.scrollIntoView({ block: 'start', behavior: 'auto' });
      queueContents();
    };
    if (document.readyState === 'complete') alignInitialSection();
    else window.addEventListener('load', alignInitialSection, { once: true });
    syncContents();
  }

  // Content stays visible when motion is reduced or observers are unavailable.
  if (!reducedMotion.matches && typeof window.IntersectionObserver === 'function') {
    const reveal = new window.IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        if (!entry.target.contains(document.activeElement)) entry.target.classList.add('is-revealed');
        reveal.unobserve(entry.target);
      });
    }, { threshold: 0.08 });
    document.querySelectorAll('.hero-copy, .hero-photo, .home-2027, .news-item, .feature-link, .update-section, .document-card, .pie-chart, .member-card, .executive-grid > article, .event-photo, .history-timeline li').forEach(el => reveal.observe(el));
  }

  if (nav && mobileButton && header) {
    const closeBranch = li => {
      [li, ...li.querySelectorAll('li.is-open')].forEach(item => {
        item.classList.remove('is-open');
        item.querySelector(':scope > .dropdown-toggle')?.setAttribute('aria-expanded', 'false');
      });
    };
    const closeBranches = () => nav.querySelectorAll('.nav-level-0 > li').forEach(closeBranch);
    const closeMenu = (restoreFocus = false) => {
      nav.classList.remove('is-open');
      document.body.classList.remove('menu-open');
      mobileButton.setAttribute('aria-expanded', 'false');
      mobileButton.setAttribute('aria-label', text.menuOpen);
      closeBranches();
      if (restoreFocus) mobileButton.focus();
    };
    mobileButton.addEventListener('click', () => {
      if (mobileButton.getAttribute('aria-expanded') === 'true') {
        closeMenu();
        return;
      }
      if (!compactMenu.matches) return;
      updateMenuHeight();
      nav.classList.add('is-open');
      document.body.classList.add('menu-open');
      mobileButton.setAttribute('aria-expanded', 'true');
      mobileButton.setAttribute('aria-label', text.menuClose);
    });
    nav.querySelectorAll('.dropdown-toggle').forEach(button => {
      button.addEventListener('click', () => {
        const li = button.parentElement;
        const open = button.getAttribute('aria-expanded') !== 'true';
        if (!open) {
          closeBranch(li);
          return;
        }
        [...li.parentElement.children].forEach(other => {
          if (other !== li) closeBranch(other);
        });
        button.setAttribute('aria-expanded', 'true');
        li.classList.add('is-open');
      });
    });
    header.addEventListener('click', e => {
      if (e.target.closest('a')) closeMenu();
    });
    document.addEventListener('click', e => {
      if (!header.contains(e.target)) closeMenu();
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || document.querySelector('.photo-dialog[open]')) return;
      if (nav.classList.contains('is-open')) {
        e.preventDefault();
        closeMenu(true);
      } else {
        const branch = nav.querySelector('li.is-open');
        if (!branch) return;
        const button = branch.querySelector(':scope > .dropdown-toggle');
        closeBranches();
        button?.focus();
        e.preventDefault();
      }
    });
    header.addEventListener('focusout', e => {
      if (e.relatedTarget && !header.contains(e.relatedTarget)) closeMenu();
    });
    compactMenu.addEventListener('change', () => {
      const hadFocus = nav.contains(document.activeElement);
      const toggleHadFocus = document.activeElement === mobileButton;
      closeMenu();
      if (compactMenu.matches && hadFocus) mobileButton.focus();
      else if (!compactMenu.matches && (hadFocus || toggleHadFocus)) nav.querySelector('a')?.focus();
    });
    window.addEventListener('pageshow', () => {
      closeMenu();
      updateHeaderHeight();
    });
  }

  document.querySelectorAll('[data-document-viewer]').forEach(viewer => {
    const track = viewer.querySelector('.document-track');
    const pages = [...viewer.querySelectorAll('.document-page')];
    const index = viewer.querySelector('.document-index');
    const links = index ? [...index.querySelectorAll('a')] : [];
    const previous = viewer.querySelector('[data-document-prev]');
    const next = viewer.querySelector('[data-document-next]');
    const status = viewer.querySelector('[data-document-status]');
    if (!track || !pages.length || !index || !previous || !next || !status) return;
    let current = 0;
    let scrollTimer;
    const offset = n => pages[n].offsetLeft - pages[0].offsetLeft;
    const fromHash = () => {
      const match = /^#page-(\d+)$/.exec(window.location.hash);
      if (!match) return null;
      const n = Number(match[1]) - 1;
      return n >= 0 && n < pages.length ? n : null;
    };
    const select = (n, updateHash = true) => {
      current = Math.max(0, Math.min(pages.length - 1, n));
      previous.disabled = current === 0;
      next.disabled = current === pages.length - 1;
      status.textContent = `${current + 1} / ${pages.length}`;
      pages.forEach((page, i) => {
        const active = i === current;
        if (!active && page.contains(document.activeElement)) track.focus({ preventScroll: true });
        page.inert = !active;
        page.setAttribute('aria-hidden', String(!active));
        if (!active) page.querySelector('details')?.removeAttribute('open');
        else page.querySelector('img')?.setAttribute('loading', 'eager');
        if (links[i]) {
          if (active) links[i].setAttribute('aria-current', 'page');
          else links[i].removeAttribute('aria-current');
        }
      });
      const link = links[current];
      if (link && index.clientWidth) {
        const left = link.offsetLeft - links[0].offsetLeft;
        if (left < index.scrollLeft) index.scrollLeft = left;
        else if (left + link.offsetWidth > index.scrollLeft + index.clientWidth) {
          index.scrollLeft = left + link.offsetWidth - index.clientWidth;
        }
      }
      if (updateHash && window.location.hash !== `#page-${current + 1}`) {
        window.history.replaceState(window.history.state, '', `#page-${current + 1}`);
      }
    };
    const go = (n, behavior = reducedMotion.matches ? 'auto' : 'smooth', updateHash = true) => {
      clearTimeout(scrollTimer);
      select(n, updateHash);
      track.scrollTo({ left: offset(current), behavior });
    };
    const syncFromScroll = () => {
      clearTimeout(scrollTimer);
      const nearest = pages.reduce((best, page, i) =>
        Math.abs(offset(i) - track.scrollLeft) < Math.abs(offset(best) - track.scrollLeft) ? i : best, 0);
      select(nearest);
    };
    previous.addEventListener('click', () => go(current - 1));
    next.addEventListener('click', () => go(current + 1));
    links.forEach((link, n) => link.addEventListener('click', e => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button > 0) return;
      e.preventDefault();
      go(n);
    }));
    track.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(syncFromScroll, 160);
    }, { passive: true });
    track.addEventListener('scrollend', syncFromScroll);
    viewer.addEventListener('keydown', e => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.target.closest('input, textarea, select, summary, [contenteditable="true"]')) return;
      let target;
      if (e.key === 'ArrowLeft') target = current - 1;
      else if (e.key === 'ArrowRight') target = current + 1;
      else if (e.key === 'Home') target = 0;
      else if (e.key === 'End') target = pages.length - 1;
      else return;
      e.preventDefault();
      go(target);
    });
    window.addEventListener('hashchange', () => {
      const n = fromHash();
      if (n !== null) go(n, 'auto', false);
    });
    window.addEventListener('resize', () => requestAnimationFrame(() => go(current, 'auto', false)));
    viewer.querySelector('.document-controls').hidden = false;
    go(fromHash() ?? 0, 'auto', false);
  });
  const dialog = document.querySelector('.photo-dialog');
  if (dialog && typeof dialog.showModal === 'function') {
    const photo = dialog.querySelector('img');
    const caption = dialog.querySelector('.photo-caption');
    let activePhotoLink;
    document.querySelectorAll('a[data-lightbox]').forEach(a => {
      a.addEventListener('click', e => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button > 0) return;
        e.preventDefault();
        photo.src = a.href;
        photo.alt = a.querySelector('img')?.alt || '';
        caption.textContent = a.dataset.title || a.querySelector('img')?.dataset.subtitle || '';
        dialog.showModal();
        activePhotoLink = a;
        document.body.classList.add('photo-open');
      });
    });
    photo.addEventListener('error', () => {
      if (!dialog.open) return;
      caption.textContent = text.imageFailed;
      const link = document.createElement('a');
      link.href = photo.src;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = text.originalImage;
      caption.append(' ', link);
    });
    dialog.querySelector('.photo-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', e => {
      if (e.target !== dialog) return;
      const { left, right, top, bottom } = dialog.getBoundingClientRect();
      if (e.clientX < left || e.clientX > right || e.clientY < top || e.clientY > bottom) dialog.close();
    });
    dialog.addEventListener('close', () => {
      document.body.classList.remove('photo-open');
      photo.removeAttribute('src');
      photo.alt = '';
      caption.textContent = '';
      if (activePhotoLink?.isConnected) activePhotoLink.focus({ preventScroll: true });
      activePhotoLink = null;
    });
    window.addEventListener('pageshow', e => {
      if (e.persisted && dialog.open) dialog.close();
    });
  }
  document.querySelectorAll('form[data-pending-backend]').forEach(form => {
    form.addEventListener('submit', e => {
      e.preventDefault();
      document.getElementById('contact-note')?.scrollIntoView({ block: 'center' });
    });
  });
  document.querySelectorAll('img[src]').forEach(img => {
    const error = () => {
      if (img.closest('.photo-dialog') || img.dataset.errorShown) return;
      img.dataset.errorShown = 'true';
      const message = document.createElement('p');
      message.className = 'image-error';
      message.append(text.imageError);
      const link = document.createElement('a');
      link.href = img.src;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = img.alt || text.originalURL;
      message.append(link);
      img.insertAdjacentElement('afterend', message);
    };
    img.addEventListener('error', error);
    if (img.complete && !img.naturalWidth) error();
  });
})();
