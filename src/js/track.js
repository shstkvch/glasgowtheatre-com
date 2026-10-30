/**
 * Counts outbound booking clicks and show-page views.
 *
 * The booking link itself is never touched: the browser navigates to the venue
 * exactly as it would without this script, and a beacon records that the click
 * happened. That keeps the measure off the critical path, and means a failed
 * request cannot cost somebody a ticket.
 *
 * The payload carries no cookie and no identifier — only the show, the surface
 * the link was on, and the page it was on. /functions/track.js decides what is
 * allowed through and writes it to D1.
 */
(function () {
  "use strict";
  if (!navigator.sendBeacon || document.prerendering) return;

  function send(data) {
    const body = new Blob([JSON.stringify(data)], {
      type: "text/plain;charset=UTF-8",
    });
    if (!navigator.sendBeacon("/track", body)) {
      fetch("/track", {
        method: "POST",
        body,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        keepalive: true,
      }).catch(() => {});
    }
  }

  function fromLink(link) {
    return {
      kind: "click",
      show: link.dataset.trackShow,
      venue: link.dataset.trackVenue,
      title: link.dataset.trackTitle,
      surface: link.dataset.trackSurface,
      path: location.pathname,
    };
  }

  document.addEventListener(
    "click",
    (event) => {
      if (event.defaultPrevented) return;
      const link = event.target.closest("[data-track-show]");
      if (link) send(fromLink(link));
    },
    true,
  );

  // Middle-click opens a new tab and fires auxclick rather than click.
  document.addEventListener(
    "auxclick",
    (event) => {
      if (event.button !== 1) return;
      const link = event.target.closest("[data-track-show]");
      if (link) send(fromLink(link));
    },
    true,
  );

  // Pages canonicalises .html links to extensionless URLs; both forms occur
  // in local previews and must record the same show-page view.
  const show = location.pathname.match(/^\/shows\/([a-z0-9-]+)(?:\.html)?\/?$/);
  if (show) {
    const event = (window.EVENTS || [])[0] || {};
    send({
      kind: "view",
      show: show[1],
      venue: event.venueId,
      title: event.title,
      surface: "show",
      path: location.pathname,
    });
  }
})();
