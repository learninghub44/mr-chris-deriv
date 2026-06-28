import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.tri_mode_regime_signal = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Tri-Mode signal; avoid mode {{ avoid_mode }}', {
                avoid_mode: '%1',
            }),
            message1: localize(
                'evaluate every {{ evaluation_ticks }} ticks; history {{ history }}; cooldown {{ cooldown }} ticks',
                {
                    evaluation_ticks: '%1',
                    history: '%2',
                    cooldown: '%3',
                }
            ),
            message2: localize('Differs frequency above {{ differs_threshold }} %%', {
                differs_threshold: '%1',
            }),
            message3: localize('Over/Under bias {{ bias_threshold }} %%; flat limit {{ flat_threshold }} %%', {
                bias_threshold: '%1',
                flat_threshold: '%2',
            }),
            message4: localize(
                'Rise/Fall trend {{ trend_ticks }} ticks; range of {{ range_ticks }} ticks below {{ max_range }}',
                {
                    trend_ticks: '%1',
                    range_ticks: '%2',
                    max_range: '%3',
                }
            ),
            args0: [{ type: 'input_value', name: 'AVOID_MODE', check: 'Number' }],
            args1: [
                { type: 'input_value', name: 'EVALUATION_TICKS', check: 'Number' },
                { type: 'input_value', name: 'HISTORY', check: 'Number' },
                { type: 'input_value', name: 'COOLDOWN_TICKS', check: 'Number' },
            ],
            args2: [{ type: 'input_value', name: 'DIFFERS_THRESHOLD', check: 'Number' }],
            args3: [
                { type: 'input_value', name: 'BIAS_THRESHOLD', check: 'Number' },
                { type: 'input_value', name: 'FLAT_THRESHOLD', check: 'Number' },
            ],
            args4: [
                { type: 'input_value', name: 'TREND_TICKS', check: 'Number' },
                { type: 'input_value', name: 'RANGE_TICKS', check: 'Number' },
                { type: 'input_value', name: 'MAX_RANGE', check: 'Number' },
            ],
            output: 'Number',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize('Evaluates Differs, Over/Under, and Rise/Fall regimes using one shared rule set.'),
            category: window.Blockly.Categories.Tick_Analysis,
        };
    },
    meta() {
        return {
            display_name: localize('Tri-Mode regime signal'),
            description: localize(
                'Evaluates all three regimes every 20 ticks, journals the analysis, and applies a five-tick cooldown when no setup qualifies.'
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
    const avoid_mode = valueToCode(block, 'AVOID_MODE', '0');
    const evaluation_ticks = valueToCode(block, 'EVALUATION_TICKS', '20');
    const history = valueToCode(block, 'HISTORY', '100');
    const cooldown_ticks = valueToCode(block, 'COOLDOWN_TICKS', '5');
    const differs_threshold = valueToCode(block, 'DIFFERS_THRESHOLD', '14');
    const bias_threshold = valueToCode(block, 'BIAS_THRESHOLD', '58');
    const flat_threshold = valueToCode(block, 'FLAT_THRESHOLD', '55');
    const trend_ticks = valueToCode(block, 'TREND_TICKS', '3');
    const range_ticks = valueToCode(block, 'RANGE_TICKS', '10');
    const max_range = valueToCode(block, 'MAX_RANGE', '0.6');

    window.Blockly.JavaScript.javascriptGenerator.definitions_.tri_mode_regime_state =
        'var BinaryBotPrivateTriModeState = { ticks: 0, cooldown: 0, lastMode: 0, lastDiffersDigit: -1 };';

    return [
        `(function () {
            var evaluationTicks = Math.max(1, Math.floor(Number(${evaluation_ticks}) || 20));
            var historySize = Math.max(10, Math.floor(Number(${history}) || 100));
            var cooldownTicks = Math.max(1, Math.floor(Number(${cooldown_ticks}) || 5));
            var avoidMode = Math.floor(Number(${avoid_mode}) || 0);
            var differsThreshold = Number(${differs_threshold}) || 14;
            var biasThreshold = Number(${bias_threshold}) || 58;
            var flatThreshold = Number(${flat_threshold}) || 55;
            var trendMoves = Math.max(1, Math.floor(Number(${trend_ticks}) || 3));
            var rangeSize = Math.max(2, Math.floor(Number(${range_ticks}) || 10));
            var maximumRange = Number(${max_range}) || 0.6;
            var signal = 0;
            var mode = 0;
            var modeName = '';
            var previousModeName = '';
            var digits = [];
            var ticks = [];
            var counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            var maxDigit = 0;
            var selectedDigit = 0;
            var maxCount = -1;
            var selectedCount = -1;
            var maxFrequency = 0;
            var selectedFrequency = 0;
            var overCount = 0;
            var underCount = 0;
            var overPercentage = 0;
            var underPercentage = 0;
            var tickRange = 0;
            var minimumTick = 0;
            var maximumTick = 0;
            var trendUp = true;
            var trendDown = true;
            var index = 0;
            var digit = 0;
            var trendStart = 0;
            var skipReason = '';

            if (BinaryBotPrivateTriModeState.cooldown > 0) {
                BinaryBotPrivateTriModeState.cooldown -= 1;
                if (BinaryBotPrivateTriModeState.cooldown === 0) {
                    Bot.notify({
                        className: 'journal__text--info',
                        message:
                            'Tri-Mode cooldown complete. Collecting a fresh ' +
                            evaluationTicks +
                            '-tick analysis window.',
                        sound: '',
                    });
                }
                return 0;
            } else {
                BinaryBotPrivateTriModeState.ticks += 1;
                if (BinaryBotPrivateTriModeState.ticks === 1) {
                    Bot.notify({
                        className: 'journal__text--info',
                        message: 'Tri-Mode collecting ' + evaluationTicks + ' ticks before the next analysis.',
                        sound: '',
                    });
                }
                if (BinaryBotPrivateTriModeState.ticks < evaluationTicks) {
                    return 0;
                }
            }

            BinaryBotPrivateTriModeState.ticks = 0;
            digits = Bot.getLastDigitList().slice(-historySize);
            ticks = Bot.getTicks(false).slice(-rangeSize);

            if (digits.length < historySize || ticks.length < rangeSize || ticks.length < trendMoves + 1) {
                BinaryBotPrivateTriModeState.cooldown = cooldownTicks;
                Bot.notify({
                    className: 'journal__text--warn',
                    message:
                        'Tri-Mode conditions not met: waiting for ' +
                        historySize +
                        ' digits and ' +
                        rangeSize +
                        ' price ticks. Cooldown ' +
                        cooldownTicks +
                        ' ticks.',
                    sound: '',
                });
                return 0;
            }

            for (index = 0; index < digits.length; index += 1) {
                digit = Number(digits[index]);
                if (digit >= 0 && digit <= 9) {
                    counts[digit] += 1;
                    if (digit >= 5) {
                        overCount += 1;
                    } else {
                        underCount += 1;
                    }
                }
            }

            for (digit = 0; digit < 10; digit += 1) {
                if (counts[digit] > maxCount) {
                    maxCount = counts[digit];
                    maxDigit = digit;
                }
                if (digit !== BinaryBotPrivateTriModeState.lastDiffersDigit && counts[digit] > selectedCount) {
                    selectedCount = counts[digit];
                    selectedDigit = digit;
                }
            }

            maxFrequency = (maxCount / digits.length) * 100;
            selectedFrequency = (selectedCount / digits.length) * 100;
            overPercentage = (overCount / digits.length) * 100;
            underPercentage = (underCount / digits.length) * 100;
            minimumTick = Number(ticks[0]);
            maximumTick = Number(ticks[0]);
            for (index = 1; index < ticks.length; index += 1) {
                if (Number(ticks[index]) < minimumTick) {
                    minimumTick = Number(ticks[index]);
                }
                if (Number(ticks[index]) > maximumTick) {
                    maximumTick = Number(ticks[index]);
                }
            }
            tickRange = maximumTick - minimumTick;
            trendStart = ticks.length - trendMoves;
            for (index = trendStart; index < ticks.length; index += 1) {
                if (index > 0) {
                    if (!(Number(ticks[index]) > Number(ticks[index - 1]))) {
                        trendUp = false;
                    }
                    if (!(Number(ticks[index]) < Number(ticks[index - 1]))) {
                        trendDown = false;
                    }
                }
            }

            if (selectedFrequency > differsThreshold && avoidMode !== 1) {
                signal = 10 + selectedDigit;
                mode = 1;
                modeName = 'Mode A DIFFERS';
                BinaryBotPrivateTriModeState.lastDiffersDigit = selectedDigit;
            } else if (overPercentage >= biasThreshold && avoidMode !== 2) {
                signal = 20;
                mode = 2;
                modeName = 'Mode B DIGITUNDER';
            } else if (underPercentage >= biasThreshold && avoidMode !== 2) {
                signal = 21;
                mode = 2;
                modeName = 'Mode B DIGITOVER';
            } else if (
                overPercentage <= flatThreshold &&
                underPercentage <= flatThreshold &&
                tickRange < maximumRange &&
                trendUp &&
                avoidMode !== 3
            ) {
                signal = 30;
                mode = 3;
                modeName = 'Mode C CALL';
            } else if (
                overPercentage <= flatThreshold &&
                underPercentage <= flatThreshold &&
                tickRange < maximumRange &&
                trendDown &&
                avoidMode !== 3
            ) {
                signal = 31;
                mode = 3;
                modeName = 'Mode C PUT';
            }

            if (!signal) {
                if (avoidMode > 0) {
                    skipReason = ' The previously losing mode ' + avoidMode + ' remains skipped.';
                }
                BinaryBotPrivateTriModeState.cooldown = cooldownTicks;
                Bot.notify({
                    className: 'journal__text--warn',
                    message:
                        'Tri-Mode conditions not met: max digit ' +
                        maxDigit +
                        ' at ' +
                        (Math.round(maxFrequency * 100) / 100) +
                        '%, over ' +
                        (Math.round(overPercentage * 100) / 100) +
                        '%, under ' +
                        (Math.round(underPercentage * 100) / 100) +
                        '%, range ' +
                        (Math.round(tickRange * 1000) / 1000) +
                        '.' +
                        skipReason +
                        ' Cooldown ' +
                        cooldownTicks +
                        ' ticks.',
                    sound: '',
                });
                return 0;
            }

            if (BinaryBotPrivateTriModeState.lastMode > 0 && BinaryBotPrivateTriModeState.lastMode !== mode) {
                previousModeName =
                    BinaryBotPrivateTriModeState.lastMode === 1
                        ? 'Mode A DIFFERS'
                        : BinaryBotPrivateTriModeState.lastMode === 2
                          ? 'Mode B OVER/UNDER'
                          : 'Mode C RISE/FALL';
                Bot.notify({
                    className: 'journal__text--info',
                    message: 'Mode shift: ' + previousModeName + ' -> ' + modeName + '.',
                    sound: '',
                });
            }
            BinaryBotPrivateTriModeState.lastMode = mode;

            if (mode === 1) {
                Bot.notify({
                    className: 'journal__text--warn',
                    message:
                        'Risk control: Mode A DIFFERS uses 10% of the base stake because one full loss can erase many small Differs wins.',
                    sound: '',
                });
            }

            Bot.notify({
                className: 'journal__text--analysis',
                message:
                    'Tri-Mode analysis: max digit ' +
                    maxDigit +
                    ' at ' +
                    (Math.round(maxFrequency * 100) / 100) +
                    '%, selected Differs digit ' +
                    selectedDigit +
                    ' at ' +
                    (Math.round(selectedFrequency * 100) / 100) +
                    '%' +
                    ', over ' +
                    (Math.round(overPercentage * 100) / 100) +
                    '%, under ' +
                    (Math.round(underPercentage * 100) / 100) +
                    '%, range ' +
                    (Math.round(tickRange * 1000) / 1000) +
                    '. Selected ' +
                    modeName +
                    '.',
                sound: '',
            });
            return signal;
        })()`,
        window.Blockly.JavaScript.javascriptGenerator.ORDER_FUNCTION_CALL,
    ];
};
