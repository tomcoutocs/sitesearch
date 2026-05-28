import type { CompanyRow } from "@/lib/company";

export const EMAIL_TEMPLATE_STORAGE_KEY = "sitesearch-outreach-template-v2";

export const EMAIL_TEMPLATE_PLACEHOLDERS = [
  "{name}",
  "{email}",
  "{website}",
  "{phone}",
  "{address}",
  "{profession}",
] as const;

export const DEFAULT_EMAIL_SUBJECT = "Quick Idea for {name}";

export const DEFAULT_EMAIL_BODY = `Hey {name},

I was looking at your website and noticed there may be an opportunity to get more out of it, both in how it looks and how well it converts visitors into leads.

I run a small web design studio that helps {profession} businesses improve their online presence and turn more website traffic into customers.

To make this more useful, we put together a quick homepage concept for {name} at no charge. I'd be happy to send it over if you'd like to take a look.

If it feels like a good fit, we can talk through what it would take to bring it to life.

Worth sending?`;

export type OutreachTemplate = {
  subject: string;
  body: string;
};

export type TemplateContext = {
  company: Pick<
    CompanyRow,
    "name" | "email" | "websiteUrl" | "phone" | "address"
  >;
  profession?: string;
};

function displayWebsite(url: string | null) {
  if (!url?.trim()) return "";
  return url.replace(/^https?:\/\//iu, "").replace(/\/$/u, "");
}

export function applyEmailTemplate(
  template: string,
  context: TemplateContext,
): string {
  const { company, profession = "" } = context;

  const replacements: Record<string, string> = {
    "{name}": company.name.trim(),
    "{email}": company.email?.trim() ?? "",
    "{website}": displayWebsite(company.websiteUrl),
    "{phone}": company.phone?.trim() ?? "",
    "{address}": company.address?.trim() ?? "",
    "{profession}": profession.trim(),
  };

  let output = template;
  for (const [token, value] of Object.entries(replacements)) {
    output = output.replaceAll(token, value);
  }
  return output;
}

export function buildOutreachEmail(
  template: OutreachTemplate,
  context: TemplateContext,
) {
  return {
    to: context.company.email?.trim() ?? "",
    subject: applyEmailTemplate(template.subject, context),
    body: applyEmailTemplate(template.body, context),
  };
}
