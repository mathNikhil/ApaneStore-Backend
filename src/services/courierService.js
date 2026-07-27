const axios = require('axios');
const cheerio = require('cheerio');

class CourierService {
    constructor() {
        this.couriers = {
            delhivery: {
                name: 'Delhivery',
                trackingUrl: (tracking) => `https://www.delhivery.com/tracking/${tracking}`,
                statusSelectors: {
                    status: '.status-message',
                    date: '.date-time',
                    location: '.location'
                },
                eventSelector: '.event-item'
            },
            bluedart: {
                name: 'Blue Dart',
                trackingUrl: (tracking) => `https://www.bluedart.com/Tracking/${tracking}`,
                statusSelectors: {
                    status: '.status-text',
                    date: '.event-date',
                    location: '.event-location'
                },
                eventSelector: '.event-item'
            },
            dtdc: {
                name: 'DTDC',
                trackingUrl: (tracking) => `https://www.dtdc.in/tracking.asp?tracking-id=${tracking}`,
                statusSelectors: {
                    status: '.status-text',
                    date: '.date-time',
                    location: '.location-info'
                },
                eventSelector: '.event-item'
            },
            xpressbees: {
                name: 'XpressBees',
                trackingUrl: (tracking) => `https://www.xpressbees.com/tracking/${tracking}`,
                statusSelectors: {
                    status: '.status',
                    date: '.date',
                    location: '.location'
                },
                eventSelector: '.event-item'
            },
            ecom: {
                name: 'Ecom Express',
                trackingUrl: (tracking) => `https://www.ecomexpress.in/tracking/${tracking}`,
                statusSelectors: {
                    status: '.status-message',
                    date: '.event-date',
                    location: '.event-location'
                },
                eventSelector: '.event-item'
            },
            amazon: {
                name: 'Amazon Shipping',
                trackingUrl: (tracking) => `https://www.amazon.in/tracking/${tracking}`,
                statusSelectors: {
                    status: '.status-message',
                    date: '.event-date',
                    location: '.event-location'
                },
                eventSelector: '.event-item'
            },
            fedex: {
                name: 'FedEx',
                trackingUrl: (tracking) => `https://www.fedex.com/tracking/${tracking}`,
                statusSelectors: {
                    status: '.status-message',
                    date: '.event-date',
                    location: '.event-location'
                },
                eventSelector: '.event-item'
            },
            dhl: {
                name: 'DHL',
                trackingUrl: (tracking) => `https://www.dhl.com/tracking/${tracking}`,
                statusSelectors: {
                    status: '.status-message',
                    date: '.event-date',
                    location: '.event-location'
                },
                eventSelector: '.event-item'
            }
        };

        this.statusMap = {
            'in transit': 'in_transit',
            'transit': 'in_transit',
            'shipped': 'in_transit',
            'out for delivery': 'out_for_delivery',
            'out-for-delivery': 'out_for_delivery',
            'out of delivery': 'out_for_delivery',
            'delivered': 'delivered',
            'delivery': 'delivered',
            'completed': 'delivered',
            'failed': 'failed',
            'returned': 'failed',
            'cancelled': 'cancelled'
        };
    }

    async getTrackingStatus(courierName, trackingNumber) {
        try {
            const courierKey = courierName.toLowerCase().replace(/\s/g, '');
            const courier = this.couriers[courierKey];
            
            if (!courier) {
                return {
                    status: 'pending',
                    message: 'Courier not configured for auto-tracking',
                    lastUpdate: new Date().toISOString(),
                    courier: courierName,
                    trackingNumber
                };
            }

            const trackingUrl = courier.trackingUrl(trackingNumber);
            const response = await axios.get(trackingUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 15000
            });

            const html = response.data;
            const status = this.parseTrackingStatus(html, courierKey);

            return {
                ...status,
                trackingUrl,
                courier: courierName,
                trackingNumber
            };

        } catch (error) {
            console.error(`Failed to track ${courierName} ${trackingNumber}:`, error.message);
            return {
                status: 'pending',
                message: 'Unable to fetch tracking status',
                lastUpdate: new Date().toISOString(),
                courier: courierName,
                trackingNumber
            };
        }
    }

    parseTrackingStatus(html, courierKey) {
        try {
            const $ = cheerio.load(html);
            const courier = this.couriers[courierKey];
            
            if (!courier) {
                return {
                    status: 'in_transit',
                    message: 'Status unavailable',
                    lastUpdate: new Date().toISOString(),
                    events: []
                };
            }

            let statusText = '';
            let lastUpdate = '';
            let location = '';
            const events = [];

            if (courier.statusSelectors) {
                const { status, date, location: locSelector } = courier.statusSelectors;
                statusText = $(status).text().trim() || 'In transit';
                lastUpdate = $(date).text().trim() || new Date().toISOString();
                location = $(locSelector).text().trim() || '';
            }

            // Try to extract events
            $(courier.eventSelector || '.event-item, .tracking-event, .status-item').each((i, el) => {
                const eventText = $(el).text().trim();
                if (eventText && eventText.length > 10) {
                    events.push({
                        message: eventText.substring(0, 200),
                        date: new Date().toISOString()
                    });
                }
            });

            const lowerText = statusText.toLowerCase();
            let status = 'in_transit';
            
            if (lowerText.includes('delivered') || lowerText.includes('completed')) {
                status = 'delivered';
            } else if (lowerText.includes('out for delivery') || lowerText.includes('out-of-delivery')) {
                status = 'out_for_delivery';
            } else if (lowerText.includes('failed') || lowerText.includes('returned')) {
                status = 'failed';
            } else if (lowerText.includes('cancelled') || lowerText.includes('cancel')) {
                status = 'cancelled';
            }

            return {
                status,
                message: statusText || 'In transit',
                location,
                lastUpdate: lastUpdate || new Date().toISOString(),
                events: events.length > 0 ? events : [{ message: 'Tracking started', date: new Date().toISOString() }]
            };

        } catch (error) {
            console.error('Parse error:', error);
            return {
                status: 'in_transit',
                message: 'Status unavailable',
                lastUpdate: new Date().toISOString(),
                events: []
            };
        }
    }

    getCourierList() {
        return Object.values(this.couriers).map(c => ({
            name: c.name,
            value: c.name.toLowerCase().replace(/\s/g, '')
        }));
    }
}

module.exports = new CourierService();