import { createBadgeIcon } from './icon-base';

const tradeIcon = (label: string, accent = '#0f766e', background = '#ecfeff') =>
    createBadgeIcon({ label, accent, background });

export const TradeTypesAccumulatorStayInIcon = tradeIcon('ACCU');
export const TradeTypesDigitsDiffersIcon = tradeIcon('DIFF');
export const TradeTypesDigitsEvenIcon = tradeIcon('EVEN');
export const TradeTypesDigitsMatchesIcon = tradeIcon('MATCH');
export const TradeTypesDigitsOddIcon = tradeIcon('ODD');
export const TradeTypesDigitsOverIcon = tradeIcon('OVER');
export const TradeTypesDigitsUnderIcon = tradeIcon('UNDER');
export const TradeTypesHighsAndLowsHighIcon = tradeIcon('HIGH');
export const TradeTypesHighsAndLowsLowIcon = tradeIcon('LOW');
export const TradeTypesHighsAndLowsNoTouchIcon = tradeIcon('NO');
export const TradeTypesHighsAndLowsTouchIcon = tradeIcon('TOUCH');
export const TradeTypesInsAndOutsEndsInIcon = tradeIcon('IN');
export const TradeTypesInsAndOutsEndsOutIcon = tradeIcon('OUT');
export const TradeTypesInsAndOutsGoesOutIcon = tradeIcon('UP/D');
export const TradeTypesInsAndOutsStaysInIcon = tradeIcon('RANGE');
export const TradeTypesMultipliersDownIcon = tradeIcon('M-DN');
export const TradeTypesMultipliersUpIcon = tradeIcon('M-UP');
export const TradeTypesSpreadsCallIcon = tradeIcon('CALL');
export const TradeTypesSpreadsPutIcon = tradeIcon('PUT');
export const TradeTypesUpsAndDownsAsianDownIcon = tradeIcon('A-DN');
export const TradeTypesUpsAndDownsAsianUpIcon = tradeIcon('A-UP');
export const TradeTypesUpsAndDownsFallIcon = tradeIcon('FALL');
export const TradeTypesUpsAndDownsOnlyDownsIcon = tradeIcon('RLOW');
export const TradeTypesUpsAndDownsOnlyUpsIcon = tradeIcon('RHIGH');
export const TradeTypesUpsAndDownsResetDownIcon = tradeIcon('R-DN');
export const TradeTypesUpsAndDownsResetUpIcon = tradeIcon('R-UP');
export const TradeTypesUpsAndDownsRiseIcon = tradeIcon('RISE');
export const TradeTypesHighsAndLowsHigherIcon = tradeIcon('HIGH+');
export const TradeTypesHighsAndLowsLowerIcon = tradeIcon('LOW-');
