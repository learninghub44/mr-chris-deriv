import { getDecimalPlaces } from '@/components/shared';
import { localize } from '@deriv-com/translations';
import DBotStore from '../../../dbot-store';
import { excludeOptionFromContextMenu, modifyContextMenu } from '../../../utils';

const DURATION_TYPE_OPTIONS = [
    [localize('ticks'), 't'],
    [localize('seconds'), 's'],
    [localize('minutes'), 'm'],
    [localize('hours'), 'h'],
];

window.Blockly.Blocks.smart_purchase_contract = {
    purchase_capability: true,
    init() {
        this.jsonInit(this.definition());
        this.setNextStatement(false);
    },
    definition() {
        return {
            message0: localize('Smart purchase contract {{ contract_type }}', { contract_type: '%1' }),
            message1: localize('Stake {{ amount }} Duration {{ duration }} {{ duration_unit }}', {
                amount: '%1',
                duration: '%2',
                duration_unit: '%3',
            }),
            message2: localize('Prediction {{ prediction }}', { prediction: '%1' }),
            args0: [
                {
                    type: 'input_value',
                    name: 'CONTRACT_TYPE',
                },
            ],
            args1: [
                {
                    type: 'input_value',
                    name: 'AMOUNT',
                    check: 'Number',
                },
                {
                    type: 'input_value',
                    name: 'DURATION',
                    check: 'Number',
                },
                {
                    type: 'field_dropdown',
                    name: 'DURATIONTYPE_LIST',
                    options: DURATION_TYPE_OPTIONS,
                },
            ],
            args2: [
                {
                    type: 'input_value',
                    name: 'PREDICTION',
                    check: 'Number',
                },
            ],
            previousStatement: null,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize(
                'Purchases Over, Under, Even, Odd, Rise, or Fall using the supplied fixed stake.'
            ),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Smart purchase contract'),
            description: localize(
                'Purchases the next contract in a runtime-selected Over, Under, Even, Odd, Rise, or Fall sequence.'
            ),
            key_words: localize('buy, dynamic, contract'),
        };
    },
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    },
    restricted_parents: ['before_purchase'],
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.smart_purchase_contract = block => {
    if (!DBotStore?.instance?.client) return '';

    const { currency } = DBotStore.instance.client;
    const decimal_places = getDecimalPlaces(currency);
    const contract_type =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'CONTRACT_TYPE',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || "''";
    const amount =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'AMOUNT',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '0';
    const duration =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'DURATION',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '1';
    const prediction =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'PREDICTION',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '0';
    const duration_type = block.getFieldValue('DURATIONTYPE_LIST') || 't';

    return `
        (function () {
            var contractType = String(${contract_type} || 'DIGITOVER').toUpperCase();
            var supportedContractTypes = [
                'DIGITOVER',
                'DIGITUNDER',
                'DIGITEVEN',
                'DIGITODD',
                'CALL',
                'PUT'
            ];
            if (supportedContractTypes.indexOf(contractType) === -1) {
                Bot.notify({
                    className: 'journal__text--warn',
                    message: 'Unknown contract type "' + contractType + '". Falling back to DIGITOVER.',
                    sound: '',
                });
                contractType = 'DIGITOVER';
            }
            var amountValue = +(Number(${amount}).toFixed(${decimal_places}));
            var durationValue = Number(${duration}) || 1;
            var predictionValue = Number(${prediction});
            var predictionContractTypes = ['DIGITOVER', 'DIGITUNDER'];
            var requiresPrediction = predictionContractTypes.indexOf(contractType) !== -1;
            Bot.notify({
                className: 'journal__text--info',
                message:
                    'Purchase request: ' +
                    contractType +
                    ' | stake ' +
                    amountValue +
                    ' ${currency} | duration ' +
                    durationValue +
                    ' ${duration_type}' +
                    (requiresPrediction ? ' | prediction ' + predictionValue : ''),
                sound: '',
            });
            Bot.start({
                limitations        : BinaryBotPrivateLimitations,
                duration           : durationValue,
                duration_unit      : '${duration_type}',
                currency           : '${currency}',
                amount             : amountValue,
                prediction         : requiresPrediction ? predictionValue : undefined,
                barrierOffset      : undefined,
                secondBarrierOffset: undefined,
                basis              : 'stake',
                preserve_duration  : true,
            });
            Bot.purchase(contractType);
        })();
    \n`;
};
