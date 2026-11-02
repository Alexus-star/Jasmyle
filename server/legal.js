'use strict';
// LEGAL & ABOUT CONTENT, served by the API so the version a person accepted can be recorded (consents collection).
// Written to follow Kenyan law as understood in October 2026: the Data Protection Act, 2019 (No. 24 of 2019) and its Regulations of 2021,
// the Computer Misuse and Cybercrimes Act, 2018, the Consumer Protection Act, 2012, the Landlord and Tenant (Shops, Hotels and Catering
// Establishments) Act (Cap. 301), the Rent Restriction Act (Cap. 296), the Land Act / Land Registration Act, 2012, the Law of Contract Act (Cap. 23),
// the Estate Agents Act (Cap. 533), the Tax Procedures Act, 2015 and POCAMLA. It is a carefully drafted template, NOT legal advice:
// the owner of the platform must have a Kenyan advocate review it and must fill in the controller details (Admin > Privacy & legal).
const P = require('./platform');

const VERSION = '2026-10-29';
const EFFECTIVE = '29 October 2026';

function ctl() {
  const l = P.config().legal || {};
  return {
    name: l.controllerName || 'Jasmyle Properties', address: [l.address, l.town].filter(Boolean).join(', ') || 'Nairobi, Kenya',
    email: l.email || '[controller email - set in Admin > Privacy & legal]', phone: l.phone || '', dpo: l.dpoName || 'Data Protection Officer',
    dpoEmail: l.dpoEmail || l.email || '[DPO email - set in Admin > Privacy & legal]', odpc: l.odpcRegNo || '[ODPC registration number - set in Admin > Privacy & legal]',
  };
}

function about() {
  return {
    title: 'What is Jasmyle Properties?',
    lead: 'Jasmyle Properties is one place where the whole real-estate journey in Kenya happens: finding a home, renting it, paying for it, looking after it, buying and selling property and land, hosting short stays, building new developments and hiring trusted professionals - with every person only seeing what they should see.',
    sections: [
      { h: 'Who it is for', items: [
        'Landlords and owners - run properties, units, leases, rent, expenses, water and electricity, maintenance, tax (KRA MRI, VAT, eTIMS) and reports.',
        'Property managers and estate agents - manage only the properties assigned to them, list homes and land for sale, work a buyer/tenant lead pipeline and record commission.',
        'Caretakers and contractors - inspections, meter readings and repair jobs, with no access to money.',
        'Tenants - pay rent by M-Pesa, PayPal/card or bank, get receipts, report repairs, chat, and carry a verified rental passport.',
        'Buyers, renters and visitors - search verified rentals, homes and plots for sale, book viewings and get alerts, without creating an account.',
        'Service providers - valuers, surveyors, architects, lawyers, movers, cleaners, insurers and more can apply to be listed in the services directory.',
        'National Administration - verifies landlords, properties and providers, protects the platform and sees only aggregate information, never tenants\' money or private messages.' ] },
      { h: 'What it covers', items: [
        'Rentals: units, tenants, leases, automatic monthly invoices, reminders, arrears, deposits, receipts, penalties, water and electricity billing.',
        'Sales and land: for-sale listings with photos, verification by National Administration, enquiries that become leads, a pipeline from first contact to closed deal, and commission tracking.',
        'Short stays: holiday-let and serviced-apartment bookings with check-in/out, clash prevention and revenue.',
        'Development and renovation projects: budgets, milestones, costs and progress.',
        'Facility management: a register of lifts, generators, boreholes, fire equipment and more, with service reminders and history.',
        'Compliance: insurance, fire-safety certificates, business permits, land rates and licences with expiry alerts.',
        'Services marketplace: an approved directory of property professionals with request forms.',
        'Finance and tax: income, expenses, platform fee, Kenya rental income tax, VAT and eTIMS e-invoices.',
        'Messaging and notifications: in-app chat and SMS (your own SMS provider).' ] },
      { h: 'How it protects you', items: [
        'Strict roles: every request is checked against the role firewall; a landlord can never see another landlord\'s records.',
        'Passwords are hashed, administrators must use two-factor authentication, leases and secrets are encrypted, and sensitive actions are written to a tamper-evident audit trail.',
        'Rent goes straight to the landlord\'s own M-Pesa, PayPal or bank account. Jasmyle Properties does not hold or split tenants\' rent.',
        'Your data rights under the Kenya Data Protection Act, 2019 can be exercised at any time from the Privacy centre.' ] },
      { h: 'How the platform earns', paras: [
        'Landlords pay a small monthly fee per unit managed (the first units are free and every new landlord gets a free trial). Browsing, searching and booking viewings is free for the public. We do not sell personal data.' ] },
    ],
  };
}

function terms() {
  const c = ctl();
  return [
    { id: 't1', h: '1. About these Terms', paras: [
      `These Terms and Conditions ("Terms") are a legal agreement between you and ${c.name} ("Jasmyle Properties", "we", "us") about your use of the Jasmyle Properties website, mobile app and related services (the "Platform"). By creating an account, ticking the acceptance box or using the Platform you agree to these Terms and to our Privacy Notice. If you do not agree, please do not use the Platform.`,
      'Version ' + VERSION + ', effective ' + EFFECTIVE + '.'] },
    { id: 't2', h: '2. Who is who', items: [
      '"Landlord" or "Owner": a person or company that owns, or is lawfully authorised to let or sell, property listed or managed on the Platform.',
      '"Manager" or "Agent": a person appointed by a Landlord to run, let or sell property on the Landlord\'s behalf.',
      '"Caretaker" and "Contractor": staff or technicians given limited access by a Landlord.',
      '"Tenant": a person who rents a unit managed on the Platform.',
      '"Visitor": a person using public pages (searching, booking a viewing, sending an enquiry) without an account.',
      '"Provider": a business or professional listed in the services directory.',
      '"National Administration": the staff of Jasmyle Properties who operate the Platform.'] },
    { id: 't3', h: '3. Accounts and security', items: [
      'You must be at least 18 years old and able to enter a binding contract under Kenyan law.',
      'Give accurate information and keep it up to date. One person, one account; do not share your password or authenticator codes.',
      'You are responsible for everything done through your account. Tell us at once if you suspect misuse.',
      'We may require identity checks before approving a Landlord or Provider, and may refuse, suspend or close an account that breaks these Terms or the law.'] },
    { id: 't4', h: '4. What Jasmyle Properties is - and is not', paras: [
      'Jasmyle Properties provides software that helps people list, find, rent, buy, sell, manage and maintain property. We are a technology platform and intermediary. Unless we say so in writing, we are not a party to any tenancy, lease, sale, brokerage or service contract made between users, we are not an estate agent, valuer, advocate or financial adviser, and we do not guarantee that any listing, user or Provider is accurate, lawful or reliable.',
      'Rent and other payments are made directly to the Landlord\'s own M-Pesa, PayPal, card or bank accounts. We do not hold, pool or split tenants\' money and we are not a payment service provider. "Practice mode" payments are simulated and move no real money.'] },
    { id: 't5', h: '5. Landlords, Managers and Agents', items: [
      'You confirm you own the property or hold written authority to let, manage or sell it, and that every listing, photograph, price and description is true and not misleading (Consumer Protection Act, 2012).',
      'Agents confirm they are registered and licensed where the Estate Agents Act (Cap. 533) requires, and must disclose any commission or interest.',
      'You must follow the law that governs your tenancies, including the Landlord and Tenant (Shops, Hotels and Catering Establishments) Act (Cap. 301), the Rent Restriction Act (Cap. 296), the Distress for Rent Act (Cap. 293) and any lease terms. No unlawful eviction, lock-out, seizure of goods or harassment.',
      'Handle tenants\' and visitors\' personal data lawfully. For the tenant and visitor data you enter, you are a data controller in your own right and must meet the duties in Section 9 of the Privacy Notice.',
      'You are responsible for your own taxes (for example monthly rental income tax, VAT on commercial rent, and eTIMS invoices where required). Figures shown on the Platform are estimates to help you; they are not tax advice, and you file and pay through KRA.',
      'Pay the platform fee on time. If a fee is badly overdue we may pause adding new properties and tenants; rent collection from tenants is never blocked.'] },
    { id: 't6', h: '6. Tenants', items: [
      'Pay rent and charges on time, use the unit lawfully and report damage promptly.',
      'Your rental passport is created only when you choose, is shared only through a link you create, and expires. You may cancel the link at any time.'] },
    { id: 't7', h: '7. Properties and land for sale', items: [
      'Listings for sale must be verified by National Administration before the public can see them. Verification checks that the account is genuine and the listing is complete; it is NOT a legal title search and is not a guarantee of title.',
      'Buyers must do their own due diligence: carry out an official search at the Land Registry (or on the Ardhisasa platform), confirm the seller\'s identity and authority, check rates and rent clearance, and, for agricultural land, whether Land Control Board consent is needed. Use an advocate.',
      'A contract for the sale or other disposition of an interest in land must be in writing and signed as the Law of Contract Act (Cap. 23) requires. Nothing on the Platform replaces that agreement.',
      'Never pay a deposit or purchase price to a person you have not verified, and never to a personal M-Pesa number. Report suspected fraud to us and to the police.'] },
    { id: 't8', h: '8. Short stays, projects and other modules', paras: [
      'Short-stay bookings, development projects, asset registers and compliance records are tools for the Landlord\'s own records. The Landlord is responsible for the accuracy of those records, for any licences needed to host guests or build (for example county permits and Physical and Land Use Planning Act approvals), and for guests\' and workers\' safety.'] },
    { id: 't9', h: '9. Services directory and Providers', items: [
      'Providers are independent businesses. Being listed is not an endorsement or a guarantee of quality, licence, price or availability.',
      'Providers must hold the registrations their profession requires (for example valuers under the Valuers Act (Cap. 532), surveyors, architects and engineers with their statutory boards, advocates with a current practising certificate) and must give true information.',
      'Any contract for services is between you and the Provider. Agree the scope, price and payment terms in writing before work starts. We are not liable for a Provider\'s work.',
      'Providers who receive requests may use the requester\'s details only to respond to that request.'] },
    { id: 't10', h: '10. Acceptable use', paras: ['You must not:'], items: [
      'post false, duplicate, stolen or deceptive listings, fake reviews or fake identities;',
      'discriminate unlawfully or harass, threaten or defraud anyone;',
      'use the Platform for money laundering or to finance crime (see the Proceeds of Crime and Anti-Money Laundering Act); agents and others with reporting duties must meet them;',
      'attack, probe, overload or bypass the security of the Platform, or access data that is not yours (an offence under the Computer Misuse and Cybercrimes Act, 2018);',
      'scrape, harvest or resell data, or use it to send unsolicited marketing;',
      'upload malware, unlawful content or material you have no right to use.'] },
    { id: 't11', h: '11. Your content', paras: [
      'You keep ownership of the photographs, text and documents you upload. You give Jasmyle Properties a non-exclusive licence to store, display and process them to run the Platform - for example showing a verified listing to the public. You promise you have the right to upload them and that they do not infringe anyone\'s rights or privacy.'] },
    { id: 't12', h: '12. Messages and SMS', paras: [
      'The Platform sends service messages (receipts, reminders, viewing confirmations, security codes). Alerts for new listings and marketing are sent only if you opt in, and every such message tells you how to stop. SMS is sent through the provider the Landlord or National Administration configures, and standard network charges may apply.'] },
    { id: 't13', h: '13. Fees and taxes', paras: [
      'Landlord fees are shown in the Platform fee page, may change for future months with notice in the app, and are payable by M-Pesa, PayPal/card or bank. Fees shown include or exclude VAT as stated on the invoice. Fees already paid are not refundable except where the law requires.'] },
    { id: 't14', h: '14. Availability and data', paras: [
      'We work to keep the Platform available and to back up data daily, but we do not promise it will be uninterrupted or error-free. We may carry out maintenance. Keep your own copies of records you need to keep by law.'] },
    { id: 't15', h: '15. Disclaimers and limits of liability', paras: [
      'To the fullest extent the law allows, the Platform is provided "as is" and we are not liable for loss that arises from dealings between users, from a user\'s or Provider\'s acts or omissions, from inaccurate listings, from payment-provider or network failures, or from indirect or consequential loss, lost profit or lost opportunity. Our total liability to you for any claim is limited to the fees you paid to us in the 12 months before the claim. Nothing in these Terms limits liability that cannot lawfully be limited, or any right you have under the Consumer Protection Act, 2012 or the Data Protection Act, 2019.',
      'You agree to compensate us for loss caused by your breach of these Terms or by content you upload that breaks the law or another person\'s rights.'] },
    { id: 't16', h: '16. Suspension and ending', paras: [
      'You can stop using the Platform at any time. We may suspend or end access if you break these Terms, if the law requires, or to protect other users. Records we must keep by law are kept even after an account closes (see the Privacy Notice).'] },
    { id: 't17', h: '17. Governing law and disputes', paras: [
      'These Terms are governed by the laws of Kenya. Please try first to settle a dispute by talking to us; if that fails the parties will try mediation. Disputes that remain go to the courts of Kenya, including, where relevant, the Environment and Land Court for land matters, the Rent Restriction Tribunal or Business Premises Rent Tribunal for tenancies, or the Small Claims Court. Complaints about personal data may also be made to the Office of the Data Protection Commissioner.'] },
    { id: 't18', h: '18. Changes', paras: [
      'We may update these Terms. We will show a notice in the app and ask you to accept important changes. Using the Platform after the effective date means you accept the new version.'] },
    { id: 't19', h: '19. Contact', paras: [`${c.name}, ${c.address}. Email: ${c.email}.${c.phone ? ' Phone: ' + c.phone + '.' : ''}`] },
  ];
}

function privacy() {
  const c = ctl();
  return [
    { id: 'p1', h: '1. Who we are and what this notice covers', paras: [
      `${c.name} ("we") runs the Jasmyle Properties Platform. This Privacy Notice explains how we handle personal data under the Data Protection Act, 2019 (No. 24 of 2019) (the "Act") and the Data Protection (General) Regulations, 2021, and what rights you have. Version ${VERSION}, effective ${EFFECTIVE}.`,
      `Data controller: ${c.name}, ${c.address}. Contact: ${c.email}. Data Protection Officer: ${c.dpo}, ${c.dpoEmail}. Registration with the Office of the Data Protection Commissioner (ODPC): ${c.odpc}.`] },
    { id: 'p2', h: '2. Our roles and your landlord\'s role', paras: [
      'We are the data controller for Platform accounts, security, billing, the public directory and National Administration. When a Landlord, Manager or Agent enters information about tenants, buyers, leads or guests, that Landlord is the data controller for that information and we process it on the Landlord\'s behalf as a data processor, under the Landlord\'s instructions and our security measures. Each Landlord is responsible for having a lawful basis, telling their tenants how their data is used, and registering with the ODPC where the law requires.'] },
    { id: 'p3', h: '3. Personal data we collect', table: { head: ['Who', 'What', 'Why'], rows: [
      ['Everyone with an account', 'Name, email, phone number, password (stored only as a one-way hash), two-factor secret (encrypted), sign-in times, IP address, security and audit logs', 'To run and secure your account'],
      ['Landlords', 'Company name, county/town, bank and M-Pesa/PayPal details you enter (encrypted), KRA PIN, platform fee invoices and payments', 'To provide the service, bill the platform fee and prepare tax summaries'],
      ['Tenants', 'Name, phone, email, national ID or passport number, emergency contact, lease, rent invoices and payments, meter readings, maintenance requests, messages, rental passport', 'To manage the tenancy for your landlord and to give you receipts and records'],
      ['Visitors and leads', 'Name, phone, optional message, viewing requests, saved search criteria, sale enquiries', 'To pass your request to the landlord, agent or provider you contacted and to send alerts you asked for'],
      ['Providers', 'Business name, licence number, contact details, description', 'To review and list you in the directory'],
      ['Short-stay guests', 'Name, phone, stay dates', 'To manage the booking for the host'],
      ['Everyone', 'A strictly necessary session cookie; basic server logs. No advertising or tracking cookies, and no third-party analytics', 'To keep you signed in and keep the service secure']] },
      paras: ['We do not intentionally collect sensitive personal data (such as health, biometrics, religion or political opinion) or data about children. Photographs and documents you upload are your responsibility - please do not upload images of people without their permission.'] },
    { id: 'p4', h: '4. Why we use your data (lawful bases)', items: [
      'Contract - to create your account, provide the features you use and bill the platform fee (section 30(1)(b) of the Act).',
      'Legal obligation - to keep financial and tax records and respond to lawful requests from courts, KRA, the police or regulators.',
      'Consent - for SMS alerts and marketing, for publishing your details in a public listing or directory, for sharing your rental passport, and for cross-border transfers where consent is needed. You can withdraw consent at any time without affecting what happened before.',
      'Legitimate interests - fraud prevention, security monitoring and improving the service, where this does not override your rights.'] },
    { id: 'p5', h: '5. How we use data - the principles we follow', paras: ['We follow the principles in section 25 of the Act:'], items: [
      'lawful, fair and transparent processing;', 'collection for specified, explicit and legitimate purposes only;', 'adequate, relevant and limited to what is necessary;',
      'accurate and kept up to date;', 'kept no longer than needed;', 'protected by appropriate security;', 'not transferred outside Kenya without safeguards.'] },
    { id: 'p6', h: '6. Who we share data with', items: [
      'Within a landlord\'s organisation: the Landlord and the Managers, Caretakers and Contractors the Landlord authorises, limited by role and property.',
      'Payment providers you choose to use: Safaricom (M-Pesa Daraja), PayPal and banks, only what is needed to process a payment.',
      'SMS gateway configured for your organisation (for example Africa\'s Talking), only phone number and message text.',
      'The Kenya Revenue Authority, when a Landlord sends eTIMS invoices or files tax returns, and other authorities where the law requires or a court orders.',
      'Cloud hosting and backup providers that store the data for us under confidentiality and security terms.',
      'A Provider or Agent you chose to contact, and the public when you publish a listing or directory profile.',
      'We never sell personal data and do not share it for third-party advertising.'] },
    { id: 'p7', h: '7. Transfers outside Kenya', paras: [
      'Our servers may be hosted in Kenya or in another country. Where data leaves Kenya we do so only where the Act allows: to a country with adequate data-protection safeguards, under binding contracts with equivalent protection, or with your consent. Processing that the Regulations require to take place in Kenya is kept in Kenya.'] },
    { id: 'p8', h: '8. How long we keep data', table: { head: ['Data', 'Kept for'], rows: [
      ['Account and profile', 'While your account is active, then up to 12 months in backups before deletion'],
      ['Rent invoices, payments, receipts, expenses and tax records', 'At least 5 years after the end of the tax year, or longer where the Income Tax Act, VAT Act or Tax Procedures Act requires'],
      ['Leases and tenancy records', 'For the tenancy plus 7 years (limitation period for contract claims)'],
      ['Viewing requests, sale enquiries and leads', 'Up to 24 months after the last activity, then deleted automatically'],
      ['Search alerts', 'Until you stop them; stopped alerts are deleted after 6 months'],
      ['Service requests to Providers', '24 months'],
      ['Audit trail and security logs', '7 years (tamper-evident; needed to prove who did what)'],
      ['Notifications (read)', '90 days'],
      ['Automatic backups', '30 most recent copies']] },
      paras: ['If you ask us to erase data we must keep for a legal reason, we restrict it from further use and delete it as soon as the period ends.'] },
    { id: 'p9', h: '9. Duties of landlords and agents who enter personal data', items: [
      'Collect only what you need (for example, ID numbers only where necessary for the lease or the law).',
      'Tell tenants and guests what you do with their data, and give them access and correction on request.',
      'Do not share tenants\' details with third parties (for example debt collectors, other landlords or social media) without a lawful basis.',
      'Keep staff accounts limited to those who need them and remove people who leave.',
      'Report a data breach affecting your tenants to us immediately so we can meet the 72-hour notification duty.',
      'Register with the ODPC if the Registration Regulations require it for your business.'] },
    { id: 'p10', h: '10. Security', paras: [
      'We use access control by role and property, hashed passwords (scrypt), mandatory two-factor authentication for administrators, encryption at rest for leases, photographs, payment credentials and 2FA secrets, rate limiting and request firewalls, secure cookies and HTTPS, daily backups, and a tamper-evident audit trail. No system is perfectly secure. If a breach is likely to put your rights at risk we will notify the ODPC within 72 hours of becoming aware of it and tell affected people without unreasonable delay, as section 43 of the Act requires.'] },
    { id: 'p11', h: '11. Your rights under the Data Protection Act', paras: ['Under section 26 of the Act you have the right to:'], items: [
      'be informed how your data is used (this notice);', 'access the personal data we hold about you;', 'object to processing, including for direct marketing;',
      'ask us to correct inaccurate or incomplete data;', 'ask us to delete data we no longer need or that was unlawfully processed;',
      'receive your data in a structured, commonly used format (data portability, section 38);', 'withdraw consent at any time;',
      'not be subject to a decision based only on automated processing that significantly affects you (section 35). The rental-passport grade is only a summary of recorded payments that you choose to share - no automated decision is made about you.'] },
    { id: 'p12', h: '12. How to use your rights', paras: [
      'Signed-in users: open Privacy centre in the menu to download a copy of your data at once, or to send an access, correction, erasure, objection, restriction or portability request. Visitors without an account can use the public data-request form. We answer within the periods the Data Protection (General) Regulations, 2021 set and in any event within 30 days, after confirming your identity. Requests are free unless they are clearly unfounded or excessive.',
      `You can also email ${c.dpoEmail}. If you are not satisfied you may complain to the Office of the Data Protection Commissioner, Nairobi (www.odpc.go.ke).`] },
    { id: 'p13', h: '13. Marketing and SMS', paras: [
      'We send promotional or alert messages only with your consent. Each alert message includes a way to stop. Viewing confirmations, receipts, rent reminders and security codes are service messages sent to run your tenancy or account.'] },
    { id: 'p14', h: '14. Children', paras: ['The Platform is for adults. We do not knowingly collect data from anyone under 18. If you believe we have, tell us and we will delete it.'] },
    { id: 'p15', h: '15. Cookies and local storage', paras: [
      'We use one strictly necessary, secure session cookie to keep you signed in. Your favourites and comparison list are stored only on your own device. We do not use advertising or analytics cookies.'] },
    { id: 'p16', h: '16. Changes to this notice', paras: ['If we change how we use personal data we will update this notice, change the version date and ask for your acceptance where the law requires.'] },
  ];
}

const isPlain = (x) => x && typeof x === 'object';
module.exports = { VERSION, EFFECTIVE, about, terms, privacy, ctl, isPlain };
