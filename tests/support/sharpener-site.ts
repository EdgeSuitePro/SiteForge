import { html, redirect, text, type Handler } from './fixture-server';

/**
 * A fixture sharpening-business website with realistic structure and deliberate hazards:
 * apex→www redirect, robots rules, a sitemap-only page, a calendar crawl trap, a 404,
 * an off-site redirect, a PDF, a nofollow page, and an internal redirect.
 */
export function sharpenerSite(getPort: () => number): { routes: Record<string, Handler>; fallback: Handler } {
  const nav = `<header><nav>
      <a href="/services">Services</a><a href="/pricing">Pricing</a>
      <a href="/about">About</a><a href="/contact">Contact</a></nav></header>`;
  const page = (title: string, body: string) =>
    html(`${nav}<main><h1>${title}</h1>${body}</main><footer><a href="https://facebook.com/edgeworks">Facebook</a></footer>`,
      `<title>${title} | Edge Works Sharpening</title>`);

  const routes: Record<string, Handler> = {
    '/robots.txt': text(200, 'User-agent: *\nDisallow: /private\n\nSitemap: /sitemap.xml\n'),
    '/sitemap.xml': (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(
        `<?xml version="1.0"?><urlset><url><loc>http://www.edgeworks.test:${getPort()}/faq</loc></url>` +
          `<url><loc>https://evil.example/elsewhere</loc></url></urlset>`,
      );
    },
    '/services': page(
      'Knife sharpening services',
      `<p>Kitchen knives, scissors and garden tools.</p><a href="/old-page">Our story</a><a href="/menu.pdf">Price list (PDF)</a>`,
    ),
    '/pricing': page('Pricing', '<p>See our current rates.</p><a href="/missing">Gift cards</a>'),
    '/about': page('About us', '<p>Family-run sharpening shop.</p>'),
    '/contact': page('Contact', '<p>Call or text to book.</p><a href="/offsite">Book online</a>'),
    '/faq': page('FAQ', '<p>How long does sharpening take?</p>'),
    '/old-page': redirect('/about', 301),
    '/offsite': redirect('https://booking.elsewhere.example/edgeworks'),
    '/menu.pdf': text(200, '%PDF', 'application/pdf'),
    '/nofollow': html('<a href="/hidden-by-nofollow">x</a>', '<meta name="robots" content="nofollow">'),
    '/hidden-by-nofollow': page('Hidden', ''),
    '/private/staff-notes': page('Private', ''),
  };

  const fallback: Handler = (req, res, url) => {
    const host = req.headers.host ?? '';
    if (host.startsWith('edgeworks.test')) {
      // apex → www, like many real sites
      res.writeHead(301, { location: `http://www.edgeworks.test:${getPort()}${url.pathname}` });
      res.end();
      return;
    }
    if (url.pathname === '/') {
      page(
        'Edge Works Sharpening',
        `<p>Professional knife sharpening in Springfield.</p>
         <a href="/private/staff-notes">Staff</a><a href="/nofollow">Notes</a>
         <a href="/events/2024/01/01">Events</a><a href="/blog/page/2">Older posts</a>
         <a href="http://edgeworks.test:${getPort()}/services">Services (apex link)</a>`,
      )(req, res, url);
      return;
    }
    const event = /^\/events\/(\d+)\/(\d+)\/(\d+)$/.exec(url.pathname);
    if (event) {
      // Infinite calendar: every day links to the next.
      const next = new Date(Date.UTC(Number(event[1]), Number(event[2]) - 1, Number(event[3]) + 1));
      const path = `/events/${next.getUTCFullYear()}/${next.getUTCMonth() + 1}/${next.getUTCDate()}`;
      html(`<h1>Events</h1><a href="${path}">Next day</a>`)(req, res, url);
      return;
    }
    if (url.pathname === '/blog/page/2') {
      page('Older posts', '')(req, res, url);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end('<h1>Not found</h1>');
  };

  return { routes, fallback };
}
