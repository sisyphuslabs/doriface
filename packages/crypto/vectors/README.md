# Test vectors

The two `*_25519_ChaChaPoly_BLAKE2s` IK patterns this package implements, copied verbatim (entries filtered by
protocol name, JSON re-indented) from the official vector files:

| File                 | Entries                                                                      | Source                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `cacophony.json`     | `Noise_IK_25519_ChaChaPoly_BLAKE2s`, `Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s` | https://github.com/haskell-cryptography/cacophony/blob/18b7348c54fd61fcd0c220298883de0d09c8364d/vectors/cacophony.txt |
| `noise-c-basic.json` | `Noise_IK_25519_ChaChaPoly_BLAKE2s`                                          | https://github.com/rweather/noise-c/blob/5d0a74760320e5486ced302e36ccad91606aac43/tests/vector/noise-c-basic.txt      |

## CPace

`cpace-ristretto255-sha512.json` holds the CPACE-RISTR255-SHA512 vectors of draft-irtf-cfrg-cpace-21 (23 April 2026),
decoded verbatim from its base64 JSON blocks: A.1.2.1 (`prepend_len`), A.1.4.1 (`lv_cat`), B.3.1.1 (the generator),
B.3.9 (Ya, Yb, K and ISK) and B.3.11.1 (`scalar_mult_vfy`, valid and invalid). Source:
https://datatracker.ietf.org/doc/draft-irtf-cfrg-cpace/21/
