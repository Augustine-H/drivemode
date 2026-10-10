"""Resource-only loader adapter for the pinned upstream RVC training module."""
import os
import runpy


def loader_settings(settings, workers):
    if workers not in (0, 1, 4):
        raise ValueError('INVALID_RVC_LOADER_WORKERS')
    result = dict(settings)
    result['num_workers'] = workers
    if workers == 0:
        result.pop('prefetch_factor', None)
        result['persistent_workers'] = False
    elif workers == 1:
        result['prefetch_factor'] = 2
    return result


def main():
    workers = int(os.environ['RVC_TRAIN_LOADER_WORKERS'])
    if workers not in (0, 1, 4):
        raise ValueError('INVALID_RVC_LOADER_WORKERS')
    import torch.utils.data
    original_loader = torch.utils.data.DataLoader

    def bounded_loader(*args, **kwargs):
        return original_loader(*args, **loader_settings(kwargs, workers))

    torch.utils.data.DataLoader = bounded_loader
    print('RVC resource adapter: loader workers=' + str(workers), flush=True)
    runpy.run_module('train.train', run_name='__main__')


if __name__ == '__main__':
    main()
