// Admin Dashboard Logic
document.addEventListener('DOMContentLoaded', () => {

    // --- MOCK DATA FOR THE DEMO ---
    const mockUpcomingOrders = [
        { id: '#PBH-9921', customer: 'Alice Smith', items: '1x Margherita Hub, 2x Cola', total: 1497, status: 'Preparing', time: '12m ago' },
        { id: '#PBH-9922', customer: 'Bob Wilson', items: '2x Mighty Beef Burger', total: 1898, status: 'Out for Delivery', time: '5m ago' },
        { id: '#PBH-9923', customer: 'Charlie Brown', items: '1x Veggie Pizza (L)', total: 1249, status: 'Preparing', time: '2m ago' }
    ];

    const mockCompletedOrders = [
        { id: '#PBH-9918', time: '12:30 PM', amount: 4520, status: 'Delivered' },
        { id: '#PBH-9919', time: '01:15 PM', amount: 1299, status: 'Delivered' },
        { id: '#PBH-9920', time: '02:45 PM', amount: 3250, status: 'Delivered' }
    ];

    // --- LOAD STATS ---
    function updateStats() {
        const todayRev = 84240;
        const monthlyRev = 1242890;
        const upcomingCount = mockUpcomingOrders.length;
        const bookingCount = 12;

        document.getElementById('today-rev').innerText = `₹${todayRev.toLocaleString()}`;
        document.getElementById('monthly-rev').innerText = `₹${monthlyRev.toLocaleString()}`;
        document.getElementById('upcoming-count').innerText = upcomingCount;
        document.getElementById('booking-count').innerText = bookingCount;
    }

    // --- RENDER TABLES ---
    function renderUpcomingOrders() {
        const body = document.getElementById('upcoming-orders-body');
        if (!body) return;

        if (mockUpcomingOrders.length === 0) {
            body.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 3rem; opacity: 0.5;">No active orders.</td></tr>';
            return;
        }

        body.innerHTML = mockUpcomingOrders.map((order, index) => `
            <tr>
                <td style="font-weight: 700;">${order.id}</td>
                <td>${order.customer}</td>
                <td style="max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${order.items}</td>
                <td style="font-weight: 600;">₹${order.total.toLocaleString()}</td>
                <td><span class="badge-outline" style="color: ${order.status === 'Preparing' ? '#F39C12' : '#3498DB'};">${order.status}</span></td>
                <td><button class="btn btn-primary btn-sm done-btn" data-index="${index}">Mark Done</button></td>
            </tr>
        `).join('');

        // Action listeners
        document.querySelectorAll('.done-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = btn.dataset.index;
                const doneOrder = mockUpcomingOrders.splice(idx, 1)[0];
                
                // Add to completed
                mockCompletedOrders.unshift({
                    id: doneOrder.id,
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    amount: doneOrder.total,
                    status: 'Delivered'
                });

                renderUpcomingOrders();
                renderCompletedOrders();
                updateStats();
            });
        });
    }

    function renderCompletedOrders() {
        const body = document.getElementById('completed-orders-body');
        if (!body) return;

        body.innerHTML = mockCompletedOrders.map(order => `
            <tr>
                <td>${order.id}</td>
                <td>${order.time}</td>
                <td style="font-weight: 600;">₹${order.amount.toLocaleString()}</td>
                <td><span style="color: #27AE60; font-weight: 600; font-size: 0.8rem;">● Delivered</span></td>
            </tr>
        `).join('');
    }

    // Initialize
    updateStats();
    renderUpcomingOrders();
    renderCompletedOrders();

});
