/** Human-readable labels for crawl states and reasons (operator-facing copy). */

export const RUN_STATUS_LABEL: Record<string, string> = {
  queued: 'Waiting to start',
  running: 'Crawling',
  completed: 'Crawl complete',
  failed: 'Crawl failed',
  canceled: 'Canceled',
};

export const PROSPECT_STATUS_LABEL: Record<string, string> = {
  new: 'Not analyzed',
  analyzing: 'Analyzing',
  analyzed: 'Analyzed',
  failed: 'Needs attention',
  archived: 'Archived',
};

export function stopReasonText(reason: string | null, maxPages: number): string | null {
  switch (reason) {
    case 'exhausted':
      return 'Every discoverable page within the crawl rules was visited.';
    case 'page_limit':
      return `Stopped at the page limit (${maxPages} pages). The most important pages are crawled first.`;
    case 'time_limit':
      return 'Stopped at the time limit. The most important pages are crawled first.';
    case 'canceled':
      return 'The crawl was canceled.';
    case 'robots_disallowed':
      return "The site's robots.txt does not allow crawling, so SiteForge did not crawl it.";
    case 'start_failed':
      return 'The website could not be loaded.';
    case 'error':
      return 'The crawl stopped because of an internal error.';
    default:
      return null;
  }
}

export const SKIP_REASON_LABEL: Record<string, string> = {
  robots: 'Blocked by robots.txt',
  not_html: 'Not a web page',
  redirect_offsite: 'Redirects to another website',
  duplicate_redirect: 'Redirects to a page already crawled',
  page_limit: 'Not crawled — page limit reached',
  not_reached: 'Not crawled',
  time_limit: 'Not crawled — time limit reached',
  canceled: 'Not crawled — canceled',
};

export const DISCARD_LABEL: Record<string, string> = {
  offsite: 'Links to other websites',
  extension: 'Files (PDFs, images, documents)',
  excluded_path: 'Admin, cart and account pages',
  depth: 'Too deep in the site',
  path_too_long: 'Unusually long URLs',
  pattern_or_queue_limit: 'Repeating URL patterns (e.g. calendars)',
};
