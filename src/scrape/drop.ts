export const UI_CHROME_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "button",
  "input",
  "select",
  "textarea",
  "[role='button']",
  "[aria-hidden='true']",
].join(", ");

export const PAGE_NOISE_SELECTORS = [
  "iframe",
  "svg",
  "form",
  "nav",
  "header",
  "footer",
  "aside",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
  "[role='complementary']",
].join(", ");

export const NOISE_ATTR =
  /(^|[-_ ])(nav|menu|sidebar|cookie|consent|banner|advert|promo|share|social|comment|related|latest|trending|popular|recirc|recommend|newsletter|subscribe|breadcrumb|paywall|modal|widget|sponsor|taboola|outbrain)([-_ ]|$)/i;
