/** Opens Gmail's web compose UI with prefilled fields (user sends from their account). */

export function gmailComposeUrl(params: {
  to: string;
  subject: string;
  body: string;
}) {
  const query = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: params.to.trim(),
    su: params.subject,
    body: params.body,
  });

  return `https://mail.google.com/mail/?${query.toString()}`;
}

export function openGmailCompose(params: {
  to: string;
  subject: string;
  body: string;
}) {
  const to = params.to.trim();
  if (!to.includes("@")) {
    return false;
  }

  const url = gmailComposeUrl({ to, subject: params.subject, body: params.body });
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}
