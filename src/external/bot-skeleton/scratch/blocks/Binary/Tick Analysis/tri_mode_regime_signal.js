import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.tri_mode_regime_signal = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Six-contract sequence analysis'),
            message1: localize(
                'pull the latest {{ history }} ticks directly from Deriv before purchase; sequence step {{ sequence_step }}',
                {
                    history: '%1',
                    sequence_step: '%2',
                }
            ),
            args1: [
                { type: 'input_value', name: 'HISTORY', check: 'Number' },
                { type: 'input_value', name: 'SEQUENCE_STEP', check: 'Number' },
            ],
            output: 'Number',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize(
                'Analyses fresh Deriv history, then rotates through Over 4, Under 5, Even, Odd, Rise, and Fall.'
            ),
            category: window.Blockly.Categories.Tick_Analysis,
        };
    },
    meta() {
        return {
            display_name: localize('Six-contract sequence analysis'),
            description: localize(
                'Pulls fresh tick history before every purchase and advances the fixed Over, Under, Even, Odd, Rise, Fall sequence.'
            ),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

const valueToCode = (block, input_name, fallback) =>
    window.Blockly.JavaScript.javascriptGenerator.valueToCode(
        block,
        input_name,
        window.Blockly.JavaScript.javascriptGenerator.ORDER_NONE
    ) || fallback;

window.Blockly.JavaScript.javascriptGenerator.forBlock.tri_mode_regime_signal = block => {
    const history = valueToCode(block, 'HISTORY', '100');
    const sequence_step = valueToCode(block, 'SEQUENCE_STEP', '0');

    return [
        `(function () {
            var historySize = Math.min(5000, Math.max(10, Math.floor(Number(${history}) || 100)));
            var historyData = Bot.getRecentTickAnalysisData(historySize);
            var digits = historyData && historyData.digits ? historyData.digits : [];
            var ticks = historyData && historyData.ticks ? historyData.ticks : [];
            var sequenceSignals = [20, 21, 22, 23, 30, 31];
            var sequenceNames = ['OVER 4', 'UNDER 5', 'EVEN', 'ODD', 'RISE', 'FALL'];
            var sequenceIndex = Math.floor(Math.max(0, Number(${sequence_step}) || 0)) % 6;
            var signal = sequenceSignals[sequenceIndex];
            var overCount = 0;
            var underCount = 0;
            var evenCount = 0;
            var oddCount = 0;
            var riseCount = 0;
            var fallCount = 0;
            var validDigitCount = 0;
            var movementCount = 0;
            var index = 0;
            var digit = 0;
            var previousTick = 0;
            var currentTick = 0;
            var percentage = function (count, total) {
                return total ? Math.round((count / total) * 10000) / 100 : 0;
            };

            if (digits.length < 10 || ticks.length < 2) {
                Bot.notify({
                    className: 'journal__text--warn',
                    message:
                        'Sequence analysis stopped: Deriv returned ' +
                        digits.length +
                        ' digits and ' +
                        ticks.length +
                        ' ticks; at least 10 digits and 2 ticks are required before purchase.',
                    sound: '',
                });
                return 0;
            }

            for (index = 0; index < digits.length; index += 1) {
                digit = Number(digits[index]);
                if (digit >= 0 && digit <= 9) {
                    validDigitCount += 1;
                    if (digit > 4) {
                        overCount += 1;
                    } else {
                        underCount += 1;
                    }
                    if (digit % 2 === 0) {
                        evenCount += 1;
                    } else {
                        oddCount += 1;
                    }
                }
            }

            for (index = 1; index < ticks.length; index += 1) {
                previousTick = Number(ticks[index - 1]);
                currentTick = Number(ticks[index]);
                if (currentTick > previousTick) {
                    riseCount += 1;
                } else if (currentTick < previousTick) {
                    fallCount += 1;
                }
                movementCount += 1;
            }

            if (validDigitCount < 10) {
                Bot.notify({
                    className: 'journal__text--warn',
                    message: 'Sequence analysis stopped: valid digit history is incomplete. No contract was purchased.',
                    sound: '',
                });
                return 0;
            }

            Bot.notify({
                className: 'journal__text--analysis',
                message:
                    'Direct Deriv analysis before purchase: ' +
                    validDigitCount +
                    ' digits; Over 4 ' +
                    percentage(overCount, validDigitCount) +
                    '%, Under 5 ' +
                    percentage(underCount, validDigitCount) +
                    '%, Even ' +
                    percentage(evenCount, validDigitCount) +
                    '%, Odd ' +
                    percentage(oddCount, validDigitCount) +
                    '%, Rise ' +
                    percentage(riseCount, movementCount) +
                    '%, Fall ' +
                    percentage(fallCount, movementCount) +
                    '%. Next contract: ' +
                    sequenceNames[sequenceIndex] +
                    ' (step ' +
                    (sequenceIndex + 1) +
                    ' of 6).',
                sound: '',
            });

            return signal;
        })()`,
        window.Blockly.JavaScript.javascriptGenerator.ORDER_FUNCTION_CALL,
    ];
};
