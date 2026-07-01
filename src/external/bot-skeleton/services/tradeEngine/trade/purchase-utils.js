export const getValidatedBuyResponse = (response, contract_type) => {
    const buy = response?.buy;

    if (!buy) {
        throw new Error(
            `Bot Builder could not confirm the ${contract_type} purchase because Deriv did not return a buy response.`
        );
    }

    return buy;
};
