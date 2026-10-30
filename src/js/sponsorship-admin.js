(() => {
  'use strict';
  const core = window.SponsoredShow;
  const form = document.getElementById('sponsorship-form');
  const login = document.getElementById('sign-in-form');
  const message = document.getElementById('admin-message');
  let data;
  let dirty = false;
  let busy = false;
  function announce(text, error = false) { message.textContent = text; message.dataset.error = String(error); }
  async function api(path, options = {}) {
    const response = await fetch('/admin/api/' + path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
    const value = await response.json();
    if (!response.ok) { if (response.status === 401) showLogin(); throw new Error(value.error || 'Please try again.'); }
    return value;
  }
  function showLogin() {
    document.getElementById('manager').hidden = true;
    document.getElementById('sign-in-panel').hidden = false;
    document.getElementById('sign-out').hidden = true;
  }
  function draft() {
    const values = new FormData(form);
    return { enabled: values.has('enabled'), home: values.has('home'), detail: values.has('detail'), startsOn: values.get('startsOn'), endsOn: values.get('endsOn'), mode: values.get('mode'), showSlug: form.elements.showSlug.value || '', description: values.get('description'), revision: data?.settings.revision || 0 };
  }
  function candidate(settings) {
    const shows = [...data.shows].filter(show => show.available).sort((a, b) => (a.next.date + (a.next.time || '23:59')).localeCompare(b.next.date + (b.next.time || '23:59')));
    const show = settings.mode === 'specific' ? shows.find(show => show.slug === settings.showSlug) : shows[0];
    return show?.listing || null;
  }
  function preview() {
    if (!data) return;
    const settings = draft();
    form.elements.showSlug.disabled = settings.mode !== 'specific';
    const selected = candidate(settings);
    const today = core.londonClock().date;
    let status = !settings.enabled ? 'Paused' : settings.startsOn && settings.startsOn > today ? 'Scheduled' : settings.endsOn && settings.endsOn < today ? 'Finished' : !selected ? 'No available show' : 'Live';
    document.getElementById('live-status').textContent = status;
    document.getElementById('live-status').dataset.live = String(status === 'Live');
    document.getElementById('preview-status').textContent = dirty ? 'Preview of your unsaved changes.' : status === 'Live' ? 'Currently running. Visitors’ filters still apply on the homepage.' : `${status}. This preview shows the creative when it is eligible to run.`;
    const creative = document.getElementById('creative-preview');
    if (selected) {
      creative.innerHTML = core.renderSponsor({ ...selected, promotionalDescription: settings.description.trim() || selected.description.slice(0, 220) }, 'home');
      creative.querySelectorAll('a').forEach(link => { link.target = '_blank'; link.rel = 'noopener sponsored'; });
    } else creative.innerHTML = '<div class="empty-preview">No available upcoming performance for this selection. The public slot stays hidden.</div>';
    document.getElementById('character-count').textContent = `${settings.description.length} / 280`;
  }
  function report() {
    const tbody = document.getElementById('placement-counts');
    tbody.replaceChildren();
    for (const [key, label] of [['sponsored-home', 'Homepage'], ['sponsored-detail', 'Detail pages'], ['all', 'Total']]) {
      const totals = key === 'all' ? data.report.sponsored.totals : data.report.surfaces[key].totals;
      const row = document.createElement('tr');
      for (const value of [label, ...['today', 'week', 'month', 'all'].map(window => totals[window].clicks)]) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
      tbody.append(row);
    }
    const container = document.getElementById('show-counts');
    container.replaceChildren();
    for (const show of data.report.sponsored.shows) {
      const row = document.createElement('div'); row.className = 'show-click-row';
      const name = document.createElement('span'); name.textContent = show.title || show.id;
      const count = document.createElement('span'); count.textContent = `${show.clicks.all} clicks all time`;
      row.append(name, count); container.append(row);
    }
  }
  async function load(force = false) {
    data = await api('sponsorship' + (force ? '?refresh=1' : ''));
    const settings = data.settings;
    for (const name of ['enabled', 'home', 'detail']) form.elements[name].checked = settings[name];
    for (const name of ['startsOn', 'endsOn', 'description']) form.elements[name].value = settings[name];
    for (const radio of form.elements.mode) radio.checked = radio.value === settings.mode;
    const choice = form.elements.showSlug;
    choice.replaceChildren(new Option('Choose a show', ''));
    for (const show of data.shows) {
      const option = new Option(show.title + (show.available ? '' : ' — unavailable'), show.slug);
      option.disabled = !show.available;
      choice.append(option);
    }
    if (settings.showSlug && !data.shows.some(show => show.slug === settings.showSlug)) choice.append(new Option(settings.showSlug + ' — unavailable', settings.showSlug));
    choice.value = settings.showSlug;
    document.getElementById('sign-in-panel').hidden = true;
    document.getElementById('manager').hidden = false;
    document.getElementById('sign-out').hidden = false;
    document.getElementById('feed-checked').textContent = data.checkedAt ? 'Availability checked ' + new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }).format(new Date(data.checkedAt)) + ' (Glasgow time).' : 'Availability could not be checked.';
    document.getElementById('saved-at').textContent = 'All changes saved';
    dirty = false; preview(); report();
    if (data.warning) announce(data.warning, true);
  }
  login.addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return; busy = true;
    login.querySelector('button').disabled = true;
    try { await api('session', { method: 'POST', body: JSON.stringify({ password: login.elements.password.value }) }); login.reset(); await load(); announce('Signed in.'); }
    catch (error) { announce(error.message, true); }
    finally { busy = false; login.querySelector('button').disabled = false; }
  });
  form.addEventListener('input', () => { dirty = true; document.getElementById('saved-at').textContent = 'Unsaved changes'; preview(); });
  form.addEventListener('change', () => { dirty = true; preview(); });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    const settings = draft(); const validation = core.validateSettings(settings);
    if (validation.errors.length) return announce(validation.errors.join(' '), true);
    busy = true; document.getElementById('save-settings').disabled = true;
    try { await api('sponsorship', { method: 'PUT', body: JSON.stringify(settings) }); dirty = false; await load(); announce('Sponsorship saved. Public placements check for changes within a minute.'); }
    catch (error) { announce(error.message, true); }
    finally { busy = false; document.getElementById('save-settings').disabled = false; }
  });
  document.getElementById('refresh-feed').addEventListener('click', async () => {
    if (busy || dirty) return announce(dirty ? 'Save your changes before refreshing the shows.' : 'Please wait for the current action.');
    const button = document.getElementById('refresh-feed'); button.disabled = true; busy = true;
    try { await load(true); announce(data.warning || 'Shows refreshed.', Boolean(data.warning)); }
    catch (error) { announce(error.message, true); }
    finally { busy = false; button.disabled = false; }
  });
  document.getElementById('sign-out').addEventListener('click', async () => {
    if (busy) return;
    if (dirty) return announce('Save your changes before signing out, or reload to discard them.');
    try { await api('session', { method: 'DELETE' }); data = null; showLogin(); announce('Signed out.'); }
    catch (error) { announce(error.message, true); }
  });
  addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  document.getElementById('refresh-counts').addEventListener('click', async () => {
    const button = document.getElementById('refresh-counts'); button.disabled = true;
    try { data.report = (await api('sponsorship?report=1')).report; report(); announce('Click counts refreshed.'); }
    catch (error) { announce(error.message, true); }
    finally { button.disabled = false; }
  });
  (async () => { try { const session = await api('session'); if (session.authenticated) await load(); else showLogin(); } catch (error) { announce(error.message, true); } })();
})();
