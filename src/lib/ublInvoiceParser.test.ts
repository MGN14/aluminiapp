import { describe, it, expect } from 'vitest';
import { parseUblInvoice, looksLikeUblXml, nitsMatch, normalizeNitDigits } from './ublInvoiceParser';

// CUFE real-shaped: 96 hex (SHA-384)
const CUFE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

const EMBEDDED_INVOICE = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent>
        <sts:DianExtensions xmlns:sts="dian:gov:co:facturaelectronica:Structures-2-1">
          <sts:InvoiceControl>
            <sts:InvoiceAuthorization>18760000001</sts:InvoiceAuthorization>
            <sts:AuthorizedInvoices>
              <sts:Prefix>SETP</sts:Prefix>
              <sts:From>990000000</sts:From>
              <sts:To>995000000</sts:To>
            </sts:AuthorizedInvoices>
          </sts:InvoiceControl>
          <cbc:ID>DECOY-ID-DENTRO-DE-EXTENSION</cbc:ID>
        </sts:DianExtensions>
      </ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>10</cbc:CustomizationID>
  <cbc:ProfileID>DIAN 2.1</cbc:ProfileID>
  <cbc:ProfileExecutionID>1</cbc:ProfileExecutionID>
  <cbc:ID>SHDG 4512</cbc:ID>
  <cbc:UUID schemeID="1" schemeName="CUFE-SHA384">${CUFE}</cbc:UUID>
  <cbc:IssueDate>2026-03-10</cbc:IssueDate>
  <cbc:IssueTime>10:15:00-05:00</cbc:IssueTime>
  <cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>
  <cac:AccountingSupplierParty>
    <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>SHANDONG ALUMINIOS S.A.S</cbc:RegistrationName>
        <cbc:CompanyID schemeID="7" schemeName="31" schemeAgencyID="195">901234567</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>MGN GLOBALTRADE S.A.S</cbc:RegistrationName>
        <cbc:CompanyID schemeID="4" schemeName="31" schemeAgencyID="195">900111222</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:ID>2</cbc:ID>
    <cbc:PaymentMeansCode>42</cbc:PaymentMeansCode>
    <cbc:PaymentDueDate>2026-04-10</cbc:PaymentDueDate>
  </cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="COP">1900000.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="COP">10000000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">1900000.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:Percent>19.00</cbc:Percent>
        <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="COP">10000000.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="COP">10000000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="COP">11900000.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="COP">11900000.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="EA">100</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="COP">10000000.00</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="COP">1900000.00</cbc:TaxAmount>
    </cac:TaxTotal>
    <cac:Item><cbc:Description>Perfil aluminio 3mm</cbc:Description></cac:Item>
  </cac:InvoiceLine>
</Invoice>`;

const ATTACHED_DOCUMENT = `<?xml version="1.0" encoding="UTF-8"?>
<AttachedDocument xmlns="urn:oasis:names:specification:ubl:schema:xsd:AttachedDocument-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>12345</cbc:ID>
  <cbc:IssueDate>2026-03-11</cbc:IssueDate>
  <cac:Attachment>
    <cac:ExternalReference>
      <cbc:MimeCode>text/xml</cbc:MimeCode>
      <cbc:Description><![CDATA[${EMBEDDED_INVOICE}]]></cbc:Description>
    </cac:ExternalReference>
  </cac:Attachment>
</AttachedDocument>`;

describe('parseUblInvoice', () => {
  it('parsea el Invoice embebido en CDATA de un AttachedDocument', () => {
    const res = parseUblInvoice(ATTACHED_DOCUMENT);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const inv = res.invoice!;
    expect(inv.cufe).toBe(CUFE.toLowerCase());
    expect(inv.invoiceNumber).toBe('SHDG 4512');
    expect(inv.prefix).toBe('SHDG');
    expect(inv.numberInt).toBe(4512);
    // La fecha debe ser la del Invoice embebido, NO la del AttachedDocument (03-11)
    expect(inv.issueDate).toBe('2026-03-10');
    expect(inv.dueDate).toBe('2026-04-10');
    expect(inv.supplierName).toBe('SHANDONG ALUMINIOS S.A.S');
    expect(inv.supplierNit).toBe('901234567');
    expect(inv.supplierNitFull).toBe('901234567-7');
    expect(inv.customerName).toBe('MGN GLOBALTRADE S.A.S');
    expect(inv.customerNit).toBe('900111222');
    expect(inv.subtotal).toBe(10000000);
    expect(inv.ivaAmount).toBe(1900000);
    expect(inv.ivaRate).toBeCloseTo(0.19);
    expect(inv.total).toBe(11900000);
    expect(inv.paymentMethod).toBe('Crédito');
  });

  it('parsea un Invoice pelado (sin AttachedDocument)', () => {
    const res = parseUblInvoice(EMBEDDED_INVOICE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.invoice!.invoiceNumber).toBe('SHDG 4512');
    expect(res.invoice!.total).toBe(11900000);
  });

  it('ignora el cbc:ID decoy dentro de UBLExtensions y el TaxTotal de las líneas', () => {
    const res = parseUblInvoice(EMBEDDED_INVOICE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.invoice!.invoiceNumber).not.toContain('DECOY');
    // Si sumara el TaxTotal de la línea, daría 3.8M en vez de 1.9M
    expect(res.invoice!.ivaAmount).toBe(1900000);
  });

  it('rechaza notas crédito con razón clara', () => {
    const nc = EMBEDDED_INVOICE.replace(/<Invoice /, '<CreditNote ').replace(
      /<\/Invoice>/,
      '</CreditNote>',
    );
    const res = parseUblInvoice(nc);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason ?? '').toContain('CreditNote');
  });

  it('rechaza XML que no es UBL', () => {
    expect(parseUblInvoice('<html><body>hola</body></html>').ok).toBe(false);
    expect(parseUblInvoice('').ok).toBe(false);
  });

  it('parsea Description escapado (&lt;Invoice&gt;) sin CDATA', () => {
    const escaped = EMBEDDED_INVOICE.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const doc = ATTACHED_DOCUMENT.replace(/<!\[CDATA\[[\s\S]*\]\]>/, escaped);
    const res = parseUblInvoice(doc);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.invoice!.cufe).toBe(CUFE.toLowerCase());
    expect(res.invoice!.total).toBe(11900000);
  });
});

describe('looksLikeUblXml', () => {
  it('detecta AttachedDocument e Invoice', () => {
    expect(looksLikeUblXml(ATTACHED_DOCUMENT)).toBe(true);
    expect(looksLikeUblXml(EMBEDDED_INVOICE)).toBe(true);
    expect(looksLikeUblXml('<html></html>')).toBe(false);
  });
});

describe('nitsMatch', () => {
  it('matchea con y sin DV, puntos y guiones', () => {
    expect(nitsMatch('901234567', '901234567-7')).toBe(true);
    expect(nitsMatch('901.234.567-7', '901234567')).toBe(true);
    expect(nitsMatch('901234567', '901234567')).toBe(true);
    expect(nitsMatch('901234567', '901234568')).toBe(false);
    expect(nitsMatch('901234567', '801234567-7')).toBe(false);
    expect(nitsMatch('', '901234567')).toBe(false);
    expect(nitsMatch(null, undefined)).toBe(false);
  });
  it('normalizeNitDigits deja solo dígitos', () => {
    expect(normalizeNitDigits('901.234.567-7')).toBe('9012345677');
  });
});
