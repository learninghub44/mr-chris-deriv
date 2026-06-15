import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import Button from '@/components/shared_ui/button';
import Text from '@/components/shared_ui/text';
import TradeAnimation from '@/components/trade-animation';
import { useStore } from '@/hooks/useStore';
import { Localize } from '@deriv-com/translations';

const RunStrategy = observer(() => {
    const { run_panel } = useStore();
    const { execution_mode, setExecutionMode } = run_panel;

    return (
        <div className='toolbar__section toolbar__section--execution' data-testid='dt_run_strategy'>
            <div className='toolbar__execution-mode'>
                <Text as='span' size='xxs' weight='bold' className='toolbar__execution-mode-label'>
                    <Localize i18n_default_text='Execution' />
                </Text>
                <div className='toolbar__execution-mode-buttons'>
                    <Button
                        className={classNames('toolbar__execution-mode-button', {
                            'toolbar__execution-mode-button--active': execution_mode === 'fast',
                        })}
                        onClick={() => setExecutionMode('fast')}
                        secondary={execution_mode !== 'fast'}
                    >
                        <Localize i18n_default_text='Fast' />
                    </Button>
                    <Button
                        className={classNames('toolbar__execution-mode-button', {
                            'toolbar__execution-mode-button--active': execution_mode === 'slow',
                        })}
                        onClick={() => setExecutionMode('slow')}
                        secondary={execution_mode !== 'slow'}
                    >
                        <Localize i18n_default_text='Slow' />
                    </Button>
                </div>
            </div>
            <TradeAnimation className='toolbar__animation' />
        </div>
    );
});

export default RunStrategy;
