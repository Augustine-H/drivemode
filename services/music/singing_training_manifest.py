"""Audit a local singing-data collection manifest; never trains or approves audio."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import soundfile as sf
from provider import atomic_json, file_hash


def pcm_hash(path):
    """Detect identical decoded samples even if WAV container metadata differs."""
    digest = hashlib.sha256()
    with sf.SoundFile(path) as stream:
        digest.update(f'{stream.samplerate}:{stream.channels}'.encode())
        for block in stream.blocks(blocksize=65536, dtype='float32', always_2d=True):
            digest.update(np.ascontiguousarray(block, dtype='<f4').tobytes())
    return digest.hexdigest()


def audit(manifest_path, plan_path):
    manifest_path, plan_path = Path(manifest_path), Path(plan_path)
    manifest = json.loads(manifest_path.read_text(encoding='utf8'))
    plan = json.loads(plan_path.read_text(encoding='utf8'))
    if manifest.get('schemaVersion') != 1 or manifest.get('voiceId') not in ('ara', 'eve'):
        raise ValueError('INVALID_SINGING_MANIFEST')
    root = manifest_path.parent.resolve()
    reserved_files = [Path(p) for p in plan.get('evaluationReservedFiles', []) if Path(p).is_file()]
    reserved_hashes = {file_hash(p) for p in reserved_files}
    reserved_pcm = {pcm_hash(p) for p in reserved_files if p.suffix.lower() == '.wav'}
    rows, seen_ids, seen_content, families = [], set(), {}, {}
    for entry in manifest.get('records', []):
        errors = []
        record_id = entry.get('id')
        if not isinstance(record_id, str) or not record_id or record_id in seen_ids:
            errors.append('MISSING_OR_DUPLICATE_RECORD_ID')
        if isinstance(record_id, str):
            seen_ids.add(record_id)
        role, family = entry.get('role'), entry.get('phraseMelodyFamily')
        if role not in ('train', 'evaluation'):
            errors.append('INVALID_SPLIT')
        if not isinstance(family, str) or not family.strip():
            errors.append('FAMILY_REQUIRED')
            family = None
        else:
            families.setdefault(family, set()).add(role)
        if entry.get('origin') not in ('native_persona_singing', 'synthetic_persona_singing'):
            errors.append('NOT_PERSONA_SINGING')
        if not entry.get('lyrics', '').strip():
            errors.append('LYRICS_REQUIRED')
        if entry.get('origin') == 'synthetic_persona_singing' and not entry.get('generationProvenance'):
            errors.append('SYNTHETIC_PROVENANCE_REQUIRED')
        review = entry.get('humanReview', {})
        if any(review.get(k) is not True for k in ('pronunciation', 'personaIdentity', 'cleanVocal')) or not review.get('feedback', '').strip():
            errors.append('HUMAN_REVIEW_INCOMPLETE')
        metrics = {}
        try:
            path = (root / entry['file']).resolve()
            if not path.is_relative_to(root) or path.suffix.lower() != '.wav' or path.is_symlink():
                raise ValueError('LOCAL_WAV_REQUIRED')
            if not path.is_file() or path.stat().st_size > 128 * 2**20:
                raise ValueError('MISSING_OR_OVERSIZED_AUDIO')
            sha, content = file_hash(path), pcm_hash(path)
            if entry.get('sha256') != sha:
                errors.append('HASH_NOT_REGISTERED_OR_CHANGED')
            if sha in reserved_hashes or content in reserved_pcm:
                errors.append('RESERVED_EVALUATION_AUDIO')
            if content in seen_content:
                errors.append('DUPLICATE_DECODED_AUDIO')
                rows[seen_content[content]]['errors'].append('DUPLICATE_DECODED_AUDIO')
            else:
                seen_content[content] = len(rows)
            with sf.SoundFile(path) as stream:
                duration, peak, energy, frames = stream.frames / stream.samplerate, 0., 0., 0
                if stream.channels not in (1, 2):
                    errors.append('INVALID_CHANNEL_COUNT')
                for block in stream.blocks(blocksize=65536, dtype='float32', always_2d=True):
                    if not np.isfinite(block).all():
                        raise ValueError('NONFINITE_AUDIO')
                    peak = max(peak, float(abs(block).max()))
                    energy += float(np.square(block, dtype='float64').sum())
                    frames += block.size
                rms = float(np.sqrt(energy / max(1, frames)))
            # Collection policy, not a universal model duration requirement.
            if not 3 <= duration <= 60:
                errors.append('COLLECTION_CLIP_DURATION_OUTSIDE_3_TO_60_SECONDS')
            if peak >= .999:
                errors.append('CLIPPING_REVIEW_REQUIRED')
            if rms < 1e-5:
                errors.append('SILENT_AUDIO')
            metrics = {'sha256': sha, 'pcmSha256': content, 'seconds': duration, 'peak': peak, 'rms': rms}
        except (KeyError, ValueError, OSError, RuntimeError) as error:
            errors.append(str(error))
        rows.append({'id': record_id, 'role': role, 'phraseMelodyFamily': family, 'errors': errors, **metrics})
    for row in rows:
        if len(families.get(row['phraseMelodyFamily'], set())) > 1:
            row['errors'].append('PHRASE_MELODY_FAMILY_LEAKAGE')
        row['acceptedForCollection'] = not row['errors']
    eligible = [r for r in rows if r['acceptedForCollection']]
    counts = {role: sum(r['role'] == role for r in eligible) for role in ('train', 'evaluation')}
    return {'state': 'COLLECTION_AUDIT_COMPLETED', 'voiceId': manifest['voiceId'], 'records': rows,
            'eligibleCounts': counts, 'eligibleSeconds': {role: sum(r['seconds'] for r in eligible if r['role'] == role) for role in counts},
            'hasReviewedTrainingAndHeldoutData': all(counts.values()), 'trainingStarted': False, 'apiCostUsd': 0,
            'limitations': 'This audit checks registration, technical integrity and recorded human review. It cannot verify pronunciation, identity, accompaniment absence, near-duplicates or training sufficiency by itself. No files are copied into training or used to launch training.'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    report = audit(args.manifest, args.plan)
    atomic_json(args.report, report)
    print(json.dumps({k: report[k] for k in ('voiceId', 'eligibleCounts', 'hasReviewedTrainingAndHeldoutData', 'trainingStarted')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
