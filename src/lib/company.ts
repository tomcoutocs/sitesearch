export type CompanyRow = {
  placeResourceName: string;
  name: string;
  /** Street-level best effort from Places */
  address: string;
  /** E.164 or national spacing per Google Places */
  phone: string | null;
  /** Scraped from public storefront HTML when present */
  email: string | null;
  /** Where the mailbox was discovered (path + heuristic confidence) */
  emailSource: string | null;
  websiteUrl: string | null;
};
