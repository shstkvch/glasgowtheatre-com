(function () {
  "use strict";
  const { filterEvents, londonDate, countArtForms } = window.Listings;
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
    // Popularity reflects all upcoming listings, independent of active filters.
    const formCounts = countArtForms(upcoming);
    const pillCount = (pill) => pill.dataset.form ? formCounts[pill.dataset.form] || 0 : upcoming.length;
    pills.sort((a, b) => {
      if (!a.dataset.form) return -1;
      if (!b.dataset.form) return 1;
      return pillCount(b) - pillCount(a) || a.dataset.form.localeCompare(b.dataset.form);
    });
    pills.forEach((pill, index) => {
      pill.querySelector(".filter-pill-count").textContent = pillCount(pill);
      const group = pill.parentElement;
      if (group.children[index] !== pill) group.insertBefore(pill, group.children[index]);
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
  // -------------------------------------------------- calendar swim lanes
  const timeline = document.getElementById("cal-scroll");
  if (timeline) {
    const chart = timeline.querySelector(".cal-grid");
    const columnWidth = () =>
      parseFloat(getComputedStyle(timeline).getPropertyValue("--day")) || 40;
    /** Put a day column just past the pinned venue names, not underneath. */
    function scrollToColumn(index, behavior = "smooth") {
      timeline.scrollTo({
        left: Math.max(0, index * columnWidth() - 12),
        behavior,
      });
    }
    const todayColumn = Number(chart.style.getPropertyValue("--today")) || 0;
    // The page is built overnight, so it opens where the visitor actually is.
    scrollToColumn(todayColumn, "auto");
    const jump = document.getElementById("cal-jump");
    document
      .querySelector("[data-scroll-today]")
      ?.addEventListener("click", () => scrollToColumn(todayColumn));
    // Month chips only work with script, so they are only added with script.
    const chips = [...chart.querySelectorAll(".cal-month")].map((month) => {
      const start = Number(month.style.getPropertyValue("--start"));
      const chip = document.createElement("button");
      chip.className = "cal-chip";
      chip.type = "button";
      chip.setAttribute("aria-pressed", "false");
      chip.textContent = month.textContent.split(" ")[0].slice(0, 3);
      chip.addEventListener("click", () => scrollToColumn(start));
      jump?.append(chip);
      return { chip, start };
    });
    /** The lit chip is whichever month the chart has actually arrived at, so
        dragging and the arrow keys keep it honest, not only the chips. It is
        read from the middle of the visible dates rather than the left edge,
        because the last month is never wide enough to reach that edge. */
    function markMonth() {
      const lane =
        parseFloat(getComputedStyle(timeline).getPropertyValue("--lane-w")) || 0;
      const middle =
        timeline.scrollLeft + (timeline.clientWidth - lane) / 2;
      const column = Math.round(middle / columnWidth());
      let current = chips[0];
      for (const month of chips) if (month.start <= column) current = month;
      for (const month of chips) {
        const on = month === current;
        month.chip.classList.toggle("active", on);
        month.chip.setAttribute("aria-pressed", String(on));
      }
    }
    markMonth();
    // ------------------------------------------------ hover preview card
    const shows = window.CAL_SHOWS || {};
    const card = document.createElement("div");
    card.className = "cal-pop";
    card.hidden = true;
    card.setAttribute("aria-hidden", "true");
    card.innerHTML =
      '<span class="cal-pop-media"><img alt="" width="320" height="200"></span>' +
      '<span class="cal-pop-meta"></span><strong class="cal-pop-title"></strong>' +
      '<span class="cal-pop-dates"></span>' +
      '<span class="cal-pop-facts"><span class="fact-time"></span><span class="fact-price"></span></span>' +
      '<span class="cal-pop-summary"></span>' +
      '<span class="cal-pop-cta">Prices, times and concessions \u2192</span>';
    document.body.append(card);
    const media = card.querySelector(".cal-pop-media");
    const thumb = card.querySelector("img");
    let pending;
    function hideCard() {
      clearTimeout(pending);
      card.hidden = true;
    }
    function showCard(item) {
      const show = shows[item.dataset.show];
      if (!show) return;
      card.querySelector(".cal-pop-meta").textContent =
        show.venue + " · " + show.form;
      card.querySelector(".cal-pop-title").textContent = show.title;
      card.querySelector(".cal-pop-dates").textContent = show.dates;
      // A bar is a title's width and no more, so when it starts and what it
      // costs are only ever visible here or in the tooltip.
      const time = card.querySelector(".cal-pop-facts .fact-time");
      const price = card.querySelector(".cal-pop-facts .fact-price");
      time.textContent = show.when || "";
      time.hidden = !show.when;
      price.textContent = show.price || "";
      price.hidden = !show.price;
      card.querySelector(".cal-pop-facts").hidden = !show.when && !show.price;
      card.querySelector(".cal-pop-summary").textContent = show.summary;
      media.hidden = !show.image;
      if (show.image) thumb.src = show.image;
      card.hidden = false;
      // Measure once visible, then keep the card on screen: above the bar if
      // there is room, below if not, and never past either edge.
      const bar = item.getBoundingClientRect();
      const box = card.getBoundingClientRect();
      const gap = 10;
      const above = bar.top - box.height - gap;
      card.style.top =
        (above > 8 ? above : Math.min(bar.bottom + gap, innerHeight - box.height - 8)) +
        "px";
      card.style.left =
        Math.max(8, Math.min(bar.left, innerWidth - box.width - 8)) + "px";
    }
    thumb.addEventListener("error", () => {
      media.hidden = true;
    });
    chart.addEventListener("pointerover", (event) => {
      if (event.pointerType !== "mouse") return;
      const item = event.target.closest(".cal-item");
      clearTimeout(pending);
      if (!item) return hideCard();
      pending = setTimeout(() => showCard(item), 90);
    });
    chart.addEventListener("pointerleave", hideCard);
    timeline.addEventListener("pointerleave", hideCard);
    chart.addEventListener("focusin", (event) => {
      const item = event.target.closest(".cal-item");
      if (item) showCard(item);
      else hideCard();
    });
    chart.addEventListener("focusout", hideCard);
    // Dragging the chart is the quickest way through six months of dates.
    let dragging = null;
    timeline.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("a, button")) return;
      hideCard();
      dragging = { x: event.clientX, left: timeline.scrollLeft };
      timeline.setPointerCapture(event.pointerId);
    });
    timeline.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const moved = event.clientX - dragging.x;
      if (Math.abs(moved) > 3) timeline.classList.add("dragging");
      timeline.scrollLeft = dragging.left - moved;
    });
    const endDrag = () => {
      dragging = null;
      timeline.classList.remove("dragging");
    };
    timeline.addEventListener("scroll", () => {
      markMonth();
      hideCard();
    });
    addEventListener("scroll", hideCard, { passive: true });
    timeline.addEventListener("pointerup", endDrag);
    timeline.addEventListener("pointercancel", endDrag);
    // A week at a time with the arrow keys, once the chart has focus.
    timeline.addEventListener("keydown", (event) => {
      const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
      if (!step || event.target !== timeline) return;
      event.preventDefault();
      timeline.scrollBy({ left: step * columnWidth() * 7, behavior: "smooth" });
    });
  }
  applyFilters(false);
  // Keep a tab left open overnight honest, even between scheduled builds.
  setInterval(() => applyFilters(false), 60000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) applyFilters(false);
  });
})();
