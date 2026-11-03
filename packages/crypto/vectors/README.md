# Noise test vectors

The two `*_25519_ChaChaPoly_BLAKE2s` IK patterns this package implements, copied verbatim (entries filtered by
protocol name, JSON re-indented) from the official vector files:

| File                 | Entries                                                                      | Source                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `cacophony.json`     | `Noise_IK_25519_ChaChaPoly_BLAKE2s`, `Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s` | https://github.com/haskell-cryptography/cacophony/blob/18b7348c54fd61fcd0c220298883de0d09c8364d/vectors/cacophony.txt |
| `noise-c-basic.json` | `Noise_IK_25519_ChaChaPoly_BLAKE2s`                                          | https://github.com/rweather/noise-c/blob/5d0a74760320e5486ced302e36ccad91606aac43/tests/vector/noise-c-basic.txt      |
