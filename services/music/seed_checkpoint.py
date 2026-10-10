"""Reject incomplete learned Seed-VC weights; report unused checkpoint entries."""


def audit_checkpoint(model, checkpoint):
    saved = checkpoint['net']
    report = {}
    generated_buffers = {'estimator.input_pos', 'estimator.t_embedder.freqs'}
    for module_name, module in model.items():
        if module_name not in saved:
            raise ValueError('SEED_CHECKPOINT_MISSING_MODULE:' + module_name)
        actual = {key.removeprefix('module.'): value for key, value in saved[module_name].items()}
        expected = module.state_dict()
        parameters = dict(module.named_parameters())
        missing = sorted(expected.keys() - actual.keys())
        mismatched = sorted(key for key in expected.keys() & actual.keys()
                            if tuple(expected[key].shape) != tuple(actual[key].shape))
        invalid = sorted(set(missing + mismatched) & parameters.keys())
        if invalid:
            raise ValueError('SEED_CHECKPOINT_LEARNED_WEIGHTS_INVALID:' + ','.join(invalid))
        if set(missing + mismatched) - generated_buffers:
            raise ValueError('SEED_CHECKPOINT_UNKNOWN_BUFFER_CHANGE')
        report[module_name] = {'learnedParameterKeys': len(parameters),
                              'learnedParametersMatched': True,
                              'generatedBuffersMissing': missing,
                              'generatedBuffersDifferentShape': mismatched,
                              'unusedCheckpointKeys': sorted(actual.keys() - expected.keys())}
    return report
