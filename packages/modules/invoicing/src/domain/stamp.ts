import { createHash, createSign, createVerify, X509Certificate } from 'node:crypto'
import { type DomainError, type Result, err, ok, validationError } from '@buildflow/core'
import { qrPayload, zatcaTimestamp, QR_TAGS } from './qr'
import { invoiceHash, QR_PLACEHOLDER, UBL_EXTENSIONS_PLACEHOLDER } from './ubl'

/**
 * The cryptographic stamp. docs/01 NFR-C4, docs/11 §2
 *
 * ZATCA's signature is XAdES B-B over TWO references: the invoice (via the
 * three exclusion transforms) and the SignedProperties block that binds the
 * signing certificate. The signing key is EC secp256k1 — the CSID that the
 * Fatoora portal issues at onboarding (slice 3); until then any secp256k1
 * pair exercises the machinery, which is what the test fixtures are.
 *
 * TWO DIFFERENT HASH ENCODINGS COEXIST HERE, AND CONFUSING THEM IS THE
 * CLASSIC INTEGRATION FAILURE: the invoice hash is base64 of the RAW digest,
 * while the certificate hash and the SignedProperties hash are base64 OF THE
 * HEX STRING of the digest. That is what the ZATCA validator computes;
 * "fixing" the inconsistency produces invoices that fail clearance.
 *
 * THE SIGNEDPROPERTIES BLOCK IS HASHED AS THE EXACT BYTES BELOW. Its digest
 * is over the serialized template — indentation included — so the template
 * here is byte-frozen deliberately; reformatting it changes every signature.
 */

export interface CertificateInfo {
  /** base64(hex(sha256(certificate body))) — the double encoding is the spec's. */
  hash: string
  /** RDNs comma-joined, most-specific first — the XAdES X509IssuerName form. */
  issuer: string
  /** Decimal, not hex: ds:X509SerialNumber is an integer. */
  serialNumber: string
  /** SubjectPublicKeyInfo DER — QR tag 8 wants the raw bytes. */
  publicKey: Buffer
  /** The certificate's own signature bytes — QR tag 9, simplified invoices. */
  signature: Buffer
  /** The base64 body, headerless, as the XML embeds it. */
  body: string
}

const stripPem = (pem: string): string =>
  pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')

/**
 * Reads what the stamp needs out of an X.509 PEM.
 *
 * The certificate's own signature is not exposed by node's API, so it is
 * lifted from the DER directly: a Certificate is SEQUENCE { tbsCertificate,
 * signatureAlgorithm, signatureValue BIT STRING } and the third child is the
 * signature, minus the leading unused-bits octet. Twenty lines of ASN.1
 * walking beats a dependency that would only ever read one field.
 */
export function certificateInfo(certificatePem: string): Result<CertificateInfo, DomainError> {
  let x509: X509Certificate
  try {
    x509 = new X509Certificate(certificatePem)
  } catch {
    return err(validationError('CERTIFICATE_UNREADABLE', 'Not an X.509 certificate', {}))
  }

  const body = stripPem(certificatePem)
  const hash = Buffer.from(createHash('sha256').update(body).digest('hex')).toString('base64')

  const signature = certificateSignatureBytes(x509.raw)
  if (signature.isErr()) return err(signature.error)

  return ok({
    hash,
    issuer: x509.issuer.split('\n').reverse().join(', '),
    serialNumber: BigInt(`0x${x509.serialNumber}`).toString(10),
    publicKey: x509.publicKey.export({ type: 'spki', format: 'der' }),
    signature: signature.value,
    body,
  })
}

/** DER: reads the length at `offset` (after the tag byte); returns [length, header bytes]. */
const derLength = (der: Buffer, offset: number): [number, number] => {
  const first = der[offset] as number
  if (first < 0x80) return [first, 1]
  const count = first & 0x7f
  let length = 0
  for (let i = 1; i <= count; i += 1) length = length * 256 + (der[offset + i] as number)
  return [length, 1 + count]
}

const certificateSignatureBytes = (der: Buffer): Result<Buffer, DomainError> => {
  try {
    // Outer SEQUENCE
    let offset = 1
    const [, outerHeader] = derLength(der, offset)
    offset += outerHeader
    // Children: tbsCertificate, signatureAlgorithm, signatureValue
    for (const last of [false, false, true]) {
      offset += 1
      const [length, header] = derLength(der, offset)
      offset += header
      if (last) {
        // BIT STRING: first content octet counts unused bits; always 0 here.
        return ok(Buffer.from(der.subarray(offset + 1, offset + length)))
      }
      offset += length
    }
    return err(validationError('CERTIFICATE_MALFORMED', 'No signature in certificate', {}))
  } catch {
    return err(validationError('CERTIFICATE_MALFORMED', 'No signature in certificate', {}))
  }
}

/** ECDSA-SHA256 over the DECODED hash bytes; base64 DER signature out. */
export function digitalSignature(invoiceHashBase64: string, privateKeyPem: string): string {
  const sign = createSign('sha256')
  sign.update(Buffer.from(invoiceHashBase64, 'base64'))
  return sign.sign(privateKeyPem).toString('base64')
}

/** The verification twin — used by tests and by nothing in production. */
export function verifySignature(
  invoiceHashBase64: string,
  signatureBase64: string,
  publicKeyPem: string,
): boolean {
  const verify = createVerify('sha256')
  verify.update(Buffer.from(invoiceHashBase64, 'base64'))
  return verify.verify(publicKeyPem, Buffer.from(signatureBase64, 'base64'))
}

/** Byte-frozen: this exact text is what the SignedProperties digest is over. */
const signedPropertiesTemplate = (props: {
  signedAt: string
  certificateHash: string
  issuer: string
  serialNumber: string
}): string => `<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">
                                    <xades:SignedSignatureProperties>
                                        <xades:SigningTime>${props.signedAt}</xades:SigningTime>
                                        <xades:SigningCertificate>
                                            <xades:Cert>
                                                <xades:CertDigest>
                                                    <ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                                                    <ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${props.certificateHash}</ds:DigestValue>
                                                </xades:CertDigest>
                                                <xades:IssuerSerial>
                                                    <ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${props.issuer}</ds:X509IssuerName>
                                                    <ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${props.serialNumber}</ds:X509SerialNumber>
                                                </xades:IssuerSerial>
                                            </xades:Cert>
                                        </xades:SigningCertificate>
                                    </xades:SignedSignatureProperties>
                                </xades:SignedProperties>`

/** base64 of the HEX digest — the second of the two encodings, see above. */
const signedPropertiesHash = (signedProperties: string): string =>
  Buffer.from(createHash('sha256').update(signedProperties, 'utf8').digest('hex')).toString(
    'base64',
  )

const signatureExtension = (props: {
  invoiceHash: string
  signedPropertiesHash: string
  signature: string
  certificateBody: string
  signedProperties: string
}): string => `<ext:UBLExtension>
    <ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>
    <ext:ExtensionContent>
      <sig:UBLDocumentSignatures xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2" xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2">
        <sac:SignatureInformation>
          <cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>
          <sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>
          <ds:Signature Id="signature" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
            <ds:SignedInfo>
              <ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>
              <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/>
              <ds:Reference Id="invoiceSignedData" URI="">
                <ds:Transforms>
                  <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                    <ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath>
                  </ds:Transform>
                  <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                    <ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath>
                  </ds:Transform>
                  <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                    <ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath>
                  </ds:Transform>
                  <ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>
                </ds:Transforms>
                <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                <ds:DigestValue>${props.invoiceHash}</ds:DigestValue>
              </ds:Reference>
              <ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties">
                <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                <ds:DigestValue>${props.signedPropertiesHash}</ds:DigestValue>
              </ds:Reference>
            </ds:SignedInfo>
            <ds:SignatureValue>${props.signature}</ds:SignatureValue>
            <ds:KeyInfo>
              <ds:X509Data>
                <ds:X509Certificate>${props.certificateBody}</ds:X509Certificate>
              </ds:X509Data>
            </ds:KeyInfo>
            <ds:Object>
              <xades:QualifyingProperties Target="signature" xmlns:xades="http://uri.etsi.org/01903/v1.3.2#">
                ${props.signedProperties}
              </xades:QualifyingProperties>
            </ds:Object>
          </ds:Signature>
        </sac:SignatureInformation>
      </sig:UBLDocumentSignatures>
    </ext:ExtensionContent>
  </ext:UBLExtension>`

/** The phase 2 QR: five text tags, then hash and signature AS THEIR BASE64
 * STRINGS, then the public key and certificate signature AS RAW BYTES —
 * mixing those up decodes as garbage on the VAT app. */
export function phase2Qr(input: {
  sellerName: string
  sellerVatNumber: string
  issuedAt: Date
  invoiceTotal: string
  vatTotal: string
  invoiceHash: string
  signature: string
  publicKey: Buffer
  certificateSignature: Buffer
}): Result<string, DomainError> {
  return qrPayload([
    { tag: QR_TAGS.sellerName, value: input.sellerName },
    { tag: QR_TAGS.sellerVatNumber, value: input.sellerVatNumber },
    { tag: QR_TAGS.timestamp, value: zatcaTimestamp(input.issuedAt) },
    { tag: QR_TAGS.invoiceTotal, value: input.invoiceTotal },
    { tag: QR_TAGS.vatTotal, value: input.vatTotal },
    { tag: 6, value: input.invoiceHash },
    { tag: 7, value: input.signature },
    { tag: 8, value: new Uint8Array(input.publicKey) },
    { tag: 9, value: new Uint8Array(input.certificateSignature) },
  ])
}

export interface SignedInvoice {
  signedXml: string
  invoiceHash: string
  qr: string
}

/**
 * Stamps an unsigned document (the builder's output, placeholders intact).
 *
 * Order matters and is fixed by the data flow: the hash exists before the
 * signature (it is what gets signed), the signature before the QR (tag 7),
 * and the QR before the final document (it is embedded in it) — which is
 * only possible because the hash EXCLUDES the extension and QR blocks.
 */
export function signInvoice(input: {
  unsignedXml: string
  certificatePem: string
  privateKeyPem: string
  /** The stamp's own moment — normally the issue moment. */
  signedAt: Date
  sellerName: string
  sellerVatNumber: string
  issuedAt: Date
  invoiceTotal: string
  vatTotal: string
}): Result<SignedInvoice, DomainError> {
  if (!input.unsignedXml.includes(UBL_EXTENSIONS_PLACEHOLDER)) {
    return err(
      validationError('ALREADY_SIGNED', 'This document has no signing placeholder left', {}),
    )
  }

  const cert = certificateInfo(input.certificatePem)
  if (cert.isErr()) return err(cert.error)

  const hash = invoiceHash(input.unsignedXml)
  const signature = digitalSignature(hash, input.privateKeyPem)

  const signedProperties = signedPropertiesTemplate({
    signedAt: zatcaTimestamp(input.signedAt),
    certificateHash: cert.value.hash,
    issuer: cert.value.issuer,
    serialNumber: cert.value.serialNumber,
  })

  const qr = phase2Qr({
    sellerName: input.sellerName,
    sellerVatNumber: input.sellerVatNumber,
    issuedAt: input.issuedAt,
    invoiceTotal: input.invoiceTotal,
    vatTotal: input.vatTotal,
    invoiceHash: hash,
    signature,
    publicKey: cert.value.publicKey,
    certificateSignature: cert.value.signature,
  })
  if (qr.isErr()) return err(qr.error)

  const extension = signatureExtension({
    invoiceHash: hash,
    signedPropertiesHash: signedPropertiesHash(signedProperties),
    signature,
    certificateBody: cert.value.body,
    signedProperties,
  })

  const signedXml = input.unsignedXml
    .replace(UBL_EXTENSIONS_PLACEHOLDER, extension)
    .replace(QR_PLACEHOLDER, qr.value)

  return ok({ signedXml, invoiceHash: hash, qr: qr.value })
}
