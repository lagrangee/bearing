# Delivered label contract

formatPrimaryLabel trims surrounding whitespace and uppercases the result. formatSecondaryLabel trims surrounding whitespace and lowercases the result. Both retain internal whitespace and punctuation and preserve the string interface.

For example, primary input " active " yields "ACTIVE", and secondary input " PaUsEd " yields "paused". The exported-function tests in tests/format-label.test.ts cover these cases. This contract describes the delivered behavior used by maintained consumers.
