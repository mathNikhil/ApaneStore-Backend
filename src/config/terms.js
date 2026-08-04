// ✅ Single source of truth for the current Terms & Conditions.
// TERMS_VERSION is what actually gets recorded in terms_acceptances —
// bump it whenever TERMS_TEXT changes, so a past acceptance stays tied to
// exactly the wording that was in effect when it was accepted, even if
// this text is edited later. Never edit old accepted wording in place.
//
// ⚠️ This text was drafted as a starting point, not reviewed by a lawyer.
// Replace with attorney-reviewed language before relying on it in
// production — see the longer draft with legal notes provided separately.

const TERMS_VERSION = 'v1-2026-08-04';

const TERMS_TEXT = `TERMS & CONDITIONS — TENANT RESPONSIBILITY & PLATFORM LIABILITY

1. NATURE OF THE PLATFORM
ApnaEstore provides software tools that let you design, configure, and operate your own online store. We act solely as an intermediary providing technology infrastructure. We do not manufacture, own, inspect, or take title to any product you list. We do not select, review, approve, or edit your store content before it goes live. We are not a party to any transaction between you and your customers. Payments for UPI and similar tenant-configured methods go directly from your customer to your own payment identifier, not to us.

2. YOUR RESPONSIBILITY
You are solely responsible for: the legality of everything you list, including compliance with all applicable laws and any license your product category requires; the accuracy of your product descriptions and pricing; holding all rights and permissions for content you upload, including that it doesn't infringe anyone's intellectual property; your own tax obligations, including GST where applicable; order fulfillment, product quality, returns, and customer service; and compliance with consumer protection law applicable to online sellers. You agree to indemnify and hold ApnaEstore harmless from any claim, fine, or legal expense arising from your store, your products, your conduct, or any transaction with your customers.

3. LIMITATION OF OUR LIABILITY
To the maximum extent permitted by law, our liability to you is limited to the subscription fees you actually paid in the 12 months before any claim. We are not liable for indirect, incidental, or consequential damages including lost profits or lost data. This limitation does not apply where the law does not permit limiting liability, such as for fraud or willful misconduct.

4. DATA
We store certain data on our infrastructure to provide the service, including product data you enter and customer data (name, phone, address) submitted through your store. As between us, you are the data controller for your customers' personal data and are responsible for your own compliance with data protection law. We act as a service provider processing this data only as needed to run the platform.

5. ILLEGAL USE
You must not use ApnaEstore to sell anything illegal, counterfeit, stolen, or requiring a license you don't hold. We may suspend or terminate your store, without prior notice, if we receive a credible report of illegal activity, in order to meet our own obligations as an intermediary under Indian law. This doesn't waive your liability for anything that already happened, or entitle you to a refund of fees already paid.

6. ACCEPTANCE
By checking the box below and completing payment, you confirm you've read, understood, and agree to be bound by these terms.`;

module.exports = { TERMS_VERSION, TERMS_TEXT };
