const TradingViewComponent = () => {
    return (
        <iframe
            id='trading-view-iframe'
            style={{ width: '100%', height: '100%', minHeight: '640px', border: 'none', backgroundColor: 'white' }}
            src='https://charts.deriv.com/deriv'
            title='TradingView chart'
        />
    );
};

export default TradingViewComponent;
