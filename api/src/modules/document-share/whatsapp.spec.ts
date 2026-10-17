import { DEFAULT_WHATSAPP_MESSAGES, renderWhatsAppMessage, toWhatsAppPhone, whatsAppUrl } from '@azad/shared';

describe('toWhatsAppPhone', () => {
  it('normalises the ways an Indian mobile is written to 91 + 10 digits', () => {
    for (const p of ['9876543210', '98765 43210', '+91 98765-43210', '091 9876543210'.replace(' ', ''), '09876543210', '919876543210']) expect(toWhatsAppPhone(p)).toBe('919876543210');
  });
  it('keeps another country code; refuses what cannot be a mobile', () => {
    expect(toWhatsAppPhone('+971 50 123 4567')).toBe('971501234567');
    expect(toWhatsAppPhone('12345')).toBeNull();
    expect(toWhatsAppPhone('')).toBeNull();
    expect(toWhatsAppPhone(null)).toBeNull();
  });
});

describe('renderWhatsAppMessage', () => {
  it('fills placeholders; unknown ones become empty', () => {
    expect(renderWhatsAppMessage('Hi {customer}, {nope}your {model}', { customer: 'Ravi', model: 'MARS' })).toBe('Hi Ravi, your MARS');
  });
  it('adds the link on its own line when the greeting has no {link}', () => {
    expect(renderWhatsAppMessage('Hello {customer}', { customer: 'Ravi', link: 'https://x/y' })).toBe('Hello Ravi\nhttps://x/y');
    expect(renderWhatsAppMessage('See {link} now', { link: 'https://x/y' })).toBe('See https://x/y now');
  });
  it('every default greeting uses only known placeholders and includes the link', () => {
    for (const t of Object.values(DEFAULT_WHATSAPP_MESSAGES)) {
      expect(t).toContain('{link}');
      expect([...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).every((k) => ['customer', 'model', 'number', 'amount', 'paid', 'balance', 'date', 'business', 'link', 'expires'].includes(k!))).toBe(true);
    }
  });
});

describe('whatsAppUrl', () => {
  it('opens a chat with the number and the text, URL-encoded (emoji and new lines too)', () => {
    expect(whatsAppUrl('919876543210', 'Hi Ravi 🙏\nLink: https://x/y?a=1&b=2')).toBe(`https://wa.me/919876543210?text=${encodeURIComponent('Hi Ravi 🙏\nLink: https://x/y?a=1&b=2')}`);
    expect(whatsAppUrl(null, 'Hi')).toBe('https://wa.me/?text=Hi');
  });
});
