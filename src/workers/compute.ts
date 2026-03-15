import { attemptSync } from '@logosdx/utils';

import { WorkerBridge } from '../core/worker-bridge/bridge.js';
import { serializeRow } from '../core/dt/serialize.js';
import { deserializeRow } from '../core/dt/deserialize.js';
import type { ComputeEvents, Correlated } from '../core/worker-bridge/types.js';

const bridge = new WorkerBridge<ComputeEvents>();

bridge.on('serialize', ({ data }) => {

    const { row, columns, index, __cid } = data as Correlated<ComputeEvents['serialize']>;

    const [values, err] = attemptSync(() => serializeRow({ row, columns }));

    if (err) {

        bridge.emit(`serialize:res:${__cid}`, { values: [], index, error: err.message });

    }
    else {

        bridge.emit(`serialize:res:${__cid}`, { values, index });

    }

});

bridge.on('deserialize', ({ data }) => {

    const { values, columns, targetDialect, index, __cid } = data as Correlated<ComputeEvents['deserialize']>;

    const [record, err] = attemptSync(() => deserializeRow({ values, columns, targetDialect }));

    if (err) {

        bridge.emit(`deserialize:res:${__cid}`, { record: {}, index, error: err.message });

    }
    else {

        bridge.emit(`deserialize:res:${__cid}`, { record, index });

    }

});
