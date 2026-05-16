export type CompanyRow = {
  placeResourceName: string;
  name: string;
  /** Street-level best effort from Places */
  address: string;
  /** E.164 or national spacing per Google Places */
  phone: string | null;
  /** Google does not reliably expose mailbox addresses */
  email: string | null;
  websiteUrl: string | null;
};
