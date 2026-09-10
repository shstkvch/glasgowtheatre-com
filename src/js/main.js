(function () {
  "use strict";
  const { filterEvents, londonDate } = window.Listings;
  function repairImage(image) {
    image.hidden = true;
    image.closest(".event-card-image")?.classList.add("image-unavailable");
  }
  document.querySelectorAll("img").forEach((image) => {
    image.addEventListener("error", () => repairImage(image));
    if (image.complete && !image.naturalWidth) repairImage(image);
  });
  // The filter panel is taller than a phone screen, so it starts collapsed
  // there and the listings begin near the top. Without JS it stays open.
  const filters = document.querySelector(".filter-controls");
  const narrow = window.matchMedia("(max-width: 720px)");
  if (filters) {
    if (narrow.matches) filters.open = false;
    // The summary is hidden on desktop, so a closed panel must never survive
    // a resize back to a wide screen.
    narrow.addEventListener("change", () => {
      if (!narrow.matches) filters.open = true;
    });
  }
  const cards = [...document.querySelectorAll(".event-card")];
  const events = window.EVENTS || [];
  const search = document.getElementById("filter-search");
  const venue = document.getElementById("filter-venue");
  const from = document.getElementById("filter-date-from");
  const to = document.getElementById("filter-date-to");
  const pills = [...document.querySelectorAll(".filter-pill")];
  const count = document.getElementById("results-count");
  const empty = document.getElementById("no-results");
  const grid = document.getElementById("events-grid");
  let form = "";
  const params = new URLSearchParams(location.search);
  if (search) search.value = params.get("q") || "";
  if (venue) venue.value = params.get("venue") || "";
  if (from) from.value = params.get("from") || "";
  if (to) to.value = params.get("to") || "";
  if (pills.some((p) => p.dataset.form === params.get("form")))
    form = params.get("form");
  function applyFilters(syncURL = true) {
    const today = londonDate();
    const upcoming = filterEvents(events, { today });
    const filtered = filterEvents(events, {
      today,
      query: search?.value,
      venue: venue?.value,
      from: from?.value,
      to: to?.value,
      form,
    });
    const ids = new Set(filtered.map((e) => e.id));
    cards.forEach((card) => {
      card.hidden = !ids.has(card.dataset.id);
    });
    pills.forEach((pill) => {
      const active = (pill.dataset.form || "") === form;
      pill.classList.toggle("active", active);
      pill.setAttribute("aria-pressed", String(active));
    });
    if (count)
      count.textContent = `${filtered.length} show${filtered.length === 1 ? "" : "s"}`;
    if (empty) {
      empty.hidden = filtered.length !== 0;
      if (grid)
        empty.querySelector("p").textContent =
          from?.value && to?.value && from.value > to.value
            ? "Choose an end date on or after the start date."
            : "No shows match these filters. Try another date, venue or art form.";
    }
    document.querySelectorAll("[data-upcoming-count]").forEach((el) => {
      el.textContent = upcoming.length;
    });
    document.querySelectorAll("[data-venue-count]").forEach((el) => {
      el.textContent = new Set(upcoming.map((e) => e.venueId)).size;
    });
    document.querySelectorAll("[data-expires]").forEach((el) => {
      el.hidden = el.dataset.expires < today;
    });
    if (syncURL && grid) {
      const next = new URLSearchParams();
      for (const [key, value] of Object.entries({
        q: search?.value,
        venue: venue?.value,
        from: from?.value,
        to: to?.value,
        form: form,
      }))
        if (value) next.set(key, value);
      history.replaceState(
        null,
        "",
        location.pathname + (next.size ? "?" + next : "") + location.hash,
      );
    }
  }
  pills.forEach((pill) =>
    pill.addEventListener("click", () => {
      form = pill.dataset.form || "";
      applyFilters();
    }),
  );
  search?.addEventListener("input", () => applyFilters());
  [venue, from, to].forEach((input) =>
    input?.addEventListener("change", () => applyFilters()),
  );
  document.querySelectorAll("[data-reset]").forEach((button) =>
    button.addEventListener("click", () => {
      [search, venue, from, to].forEach((input) => {
        if (input) input.value = "";
      });
      form = "";
      applyFilters();
    }),
  );
  document.getElementById("this-week")?.addEventListener("click", () => {
    [search, venue, from, to].forEach((input) => {
      if (input) input.value = "";
    });
    form = "";
    from.value = londonDate();
    const last = new Date(from.value + "T12:00:00Z");
    last.setUTCDate(last.getUTCDate() + 6);
    to.value = last.toISOString().slice(0, 10);
    applyFilters();
  });
  applyFilters(false);
  // Keep a tab left open overnight honest, even between scheduled builds.
  setInterval(() => applyFilters(false), 60000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) applyFilters(false);
  });
})();
