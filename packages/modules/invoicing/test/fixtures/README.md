# Test fixtures — NOT secrets

A throwaway secp256k1 key pair and self-signed certificate, generated once
with openssl purely so the stamping tests can sign and verify without
shelling out. They identify nothing, protect nothing, and must never be
used outside this test folder. The real signing material is the CSID that
ZATCA's Fatoora portal issues per device at onboarding (slice 3).
