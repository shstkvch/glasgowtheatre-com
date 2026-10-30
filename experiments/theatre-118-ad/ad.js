(() => {
  const ad = document.querySelector('.ad');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const buttons = [...document.querySelectorAll('[data-scene]')];
  const motionButton = document.querySelector('.motion');
  const scenes = [
    ['SMALL STAGE.', 'BIG FEELINGS.', 'Go on. Feel something in person.'],
    ['BIG LAUGHS.', 'UP CLOSE.', 'Comedy hits different from the front row.'],
    ['LESS SCROLL.', 'MORE LIVE.', 'Your next good night starts here.'],
  ];
  let current = 0;
  let paused = reducedMotion.matches;
  let interval;
  let changeTimer;
  let revealTimer;
  let revealFrame;
  let pointerFrame;
  let hovering = false;
  let focusing = false;

  function render(index) {
    current = index;
    document.querySelector('.line-one').textContent = scenes[index][0];
    document.querySelector('.line-two').textContent = scenes[index][1];
    document.querySelector('.tagline').textContent = scenes[index][2];
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
  }

  function showScene(index) {
    clearTimeout(changeTimer);
    ad.classList.remove('changing');
    if (paused || reducedMotion.matches) return render(index);
    void ad.offsetWidth;
    ad.classList.add('changing');
    changeTimer = setTimeout(() => render(index), 220);
  }

  function schedule() {
    clearInterval(interval);
    if (!paused && !reducedMotion.matches && !hovering && !focusing && !document.hidden) {
      interval = setInterval(() => showScene((current + 1) % scenes.length), 5500);
    }
  }

  function updateMotion() {
    motionButton.hidden = reducedMotion.matches;
    ad.classList.toggle('paused', paused);
    motionButton.setAttribute('aria-pressed', String(paused));
    motionButton.setAttribute('aria-label', paused ? 'Play animation' : 'Pause animation');
    motionButton.firstElementChild.textContent = paused ? '▶' : 'Ⅱ';
    // Never leave text half faded or a curtain closed when motion stops.
    if (paused) {
      clearTimeout(changeTimer);
      clearTimeout(revealTimer);
      cancelAnimationFrame(revealFrame);
      ad.classList.remove('changing', 'opening');
    }
    schedule();
  }

  function replay() {
    clearTimeout(changeTimer);
    clearTimeout(revealTimer);
    cancelAnimationFrame(revealFrame);
    ad.classList.remove('changing');
    render(0);
    if (!paused && !reducedMotion.matches) {
      ad.classList.add('opening');
      // Paint the closed curtain without animating it across the artwork.
      document.querySelectorAll('.curtain').forEach(curtain => curtain.style.transition = 'none');
      revealFrame = requestAnimationFrame(() => {
        revealFrame = requestAnimationFrame(() => {
          document.querySelectorAll('.curtain').forEach(curtain => curtain.style.transition = '');
          revealTimer = setTimeout(() => ad.classList.remove('opening'), 250);
        });
      });
    }
    schedule();
  }

  buttons.forEach(button => button.addEventListener('click', () => {
    showScene(Number(button.dataset.scene));
    schedule();
  }));
  motionButton.addEventListener('click', () => { paused = !paused; updateMotion(); });
  ad.addEventListener('pointerenter', () => { hovering = true; schedule(); });
  ad.addEventListener('pointerleave', () => { hovering = false; schedule(); });
  ad.addEventListener('focusin', () => { focusing = true; schedule(); });
  ad.addEventListener('focusout', event => {
    if (!ad.contains(event.relatedTarget)) { focusing = false; schedule(); }
  });
  ad.addEventListener('pointermove', event => {
    if (paused || reducedMotion.matches) return;
    cancelAnimationFrame(pointerFrame);
    pointerFrame = requestAnimationFrame(() => {
      const bounds = document.querySelector('.stage').getBoundingClientRect();
      ad.style.setProperty('--spot-x', `${((event.clientX - bounds.left) / bounds.width) * 100}%`);
      ad.style.setProperty('--spot-y', `${((event.clientY - bounds.top) / bounds.height) * 100}%`);
    });
  });
  document.addEventListener('visibilitychange', schedule);
  reducedMotion.addEventListener('change', () => { paused = reducedMotion.matches; updateMotion(); });
  window.addEventListener('message', event => {
    if (event.origin === location.origin && event.source === window.parent && event.data === 'replay-ad') replay();
  });
  updateMotion();
  replay();
})();
