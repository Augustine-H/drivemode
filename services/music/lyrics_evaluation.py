"""Offline CER/WER evaluation; references must never be supplied to ASR."""
import unicodedata


def units(text, unit='characters'):
    normalized = unicodedata.normalize('NFKC', text).casefold()
    # Preserve vowel/tone marks (notably Thai and decomposed Unicode accents).
    if unit == 'characters':
        return [c for c in normalized if unicodedata.category(c)[0] in 'LNM']
    if unit == 'words':
        normalized = ''.join(c if unicodedata.category(c)[0] in 'LNM' else ' ' for c in normalized)
        return normalized.split()
    raise ValueError('EVALUATION_UNIT_INVALID')


def evaluate(reference, hypothesis, unit='characters'):
    """Whole-input edit distance, including omissions, repeats and insertions.

    Rate is undefined for an empty reference, and may exceed 1 for repetition.
    Ties prefer substitution, then deletion, then insertion; no phonetic guesses.
    """
    expected, actual = units(reference, unit), units(hypothesis, unit)
    # Each cell is (distance, substitutions, deletions, insertions).
    row = [(j, 0, 0, j) for j in range(len(actual) + 1)]
    for i, x in enumerate(expected, 1):
        next_row = [(i, 0, i, 0)]
        for j, y in enumerate(actual, 1):
            if x == y:
                next_row.append(row[j - 1])
            else:
                diagonal, above, left = row[j - 1], row[j], next_row[j - 1]
                candidates = ((diagonal[0]+1, diagonal[1]+1, diagonal[2], diagonal[3]),
                              (above[0]+1, above[1], above[2]+1, above[3]),
                              (left[0]+1, left[1], left[2], left[3]+1))
                next_row.append(min(candidates, key=lambda cell: cell[0]))
        row = next_row
    errors, substitutions, deletions, insertions = row[-1]
    return {'unit': unit, 'referenceUnits': len(expected), 'hypothesisUnits': len(actual),
            'errors': errors, 'substitutions': substitutions, 'deletions': deletions,
            'insertions': insertions, 'errorRate': errors / len(expected) if expected else None,
            'normalization': 'NFKC casefold; punctuation/spacing ignored for CER; vowel/tone marks retained'}
