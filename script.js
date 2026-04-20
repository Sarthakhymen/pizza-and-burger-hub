// PIZZA & BURGER HUB - ELITE OPERATIONAL LOGIC
const API_URL = 'http://localhost:5500/api';
const socket = io();

// GLOABL UTILS
window.showToast = (message, type = 'success') => {
    const toast = document.createElement('div');
    toast.className = `toast ${type} show`;
    toast.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
    document.body.appendChild(toast);
    setTimeout(() => { 
        toast.classList.remove('show'); 
        setTimeout(() => toast.remove(), 500); 
    }, 4000);
};

function attachCartListeners() {
    document.querySelectorAll('.add-to-cart').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', () => {
            const item = {
                id: newBtn.dataset.id,
                name: newBtn.dataset.name,
                price: parseFloat(newBtn.dataset.price),
                qty: 1
            };
            let cart = JSON.parse(localStorage.getItem('cart')) || [];
            const existing = cart.find(i => i.id === item.id);
            if (existing) existing.qty += 1;
            else cart.push(item);
            localStorage.setItem('cart', JSON.stringify(cart));
            window.updateCartUI();
            window.showToast(`${item.name} Cart mein add ho gaya!`);
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {

    window.updateCartUI = function() {
        const cart = JSON.parse(localStorage.getItem('cart')) || [];
        const countSpan = document.getElementById('cart-count');
        const listContainer = document.getElementById('cart-items-list');
        const subtotalSpan = document.getElementById('subtotal');
        const totalSpan = document.getElementById('total-price');

        if (countSpan) countSpan.innerText = cart.reduce((acc, i) => acc + i.qty, 0);

        if (listContainer) {
            if (cart.length === 0) {
                listContainer.innerHTML = '<p style="opacity:0.3; text-align:center; padding:20px;">NO SELECTIONS</p>';
            } else {
                listContainer.innerHTML = cart.map(item => `
                    <div class="cart-item-luxury">
                        <div>
                            <h5 style="font-size:0.9rem;">${item.name}</h5>
                            <span style="font-size:0.7rem; opacity:0.5;">${item.qty} units</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:15px;">
                            <span style="font-weight:700;">₹${item.price * item.qty}</span>
                            <i class="fas fa-times remove-item" style="cursor:pointer; color:var(--primary-crimson); font-size:0.8rem;" data-id="${item.id}"></i>
                        </div>
                    </div>
                `).join('');

                document.querySelectorAll('.remove-item').forEach(trash => {
                    trash.addEventListener('click', () => {
                        let currentCart = JSON.parse(localStorage.getItem('cart')) || [];
                        currentCart = currentCart.filter(i => i.id !== trash.dataset.id);
                        localStorage.setItem('cart', JSON.stringify(currentCart));
                        window.updateCartUI();
                    });
                });
            }
        }

        const subtotal = cart.reduce((acc, i) => acc + (i.price * i.qty), 0);
        const delivery = (subtotal > 0 && subtotal < 1000) ? 40 : 0;
        if (subtotalSpan) subtotalSpan.innerText = `₹${subtotal}`;
        if (document.getElementById('delivery-fee')) document.getElementById('delivery-fee').innerText = `₹${delivery}`;
        if (totalSpan) totalSpan.innerText = `₹${subtotal + delivery}`;
    };

    window.updateCartUI();
    attachCartListeners();

    // --- CHECKOUT LOGIC ---
    const orderForm = document.getElementById('firebase-order-form');
    if (orderForm) {
        const proceedBtn = document.getElementById('proceed-checkout');
        if (proceedBtn) {
            proceedBtn.addEventListener('click', () => {
                if (JSON.parse(localStorage.getItem('cart') || '[]').length === 0) return alert('SQUAD EMPTY! Add items first.');
                document.getElementById('checkout-modal-overlay').style.display = 'flex';
            });
        }

        orderForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const currentCart = JSON.parse(localStorage.getItem('cart')) || [];
            const orderData = {
                custName: document.getElementById('cust-name').value,
                custPhone: document.getElementById('cust-phone').value,
                custAddress: document.getElementById('cust-address').value,
                type: document.getElementById('cust-type').value,
                items: currentCart,
                total: currentCart.reduce((acc, i) => acc + (i.price * i.qty), 0) + (document.getElementById('cust-type').value === 'delivery' ? 40 : 0),
                status: 'Order Placed'
            };

            try {
                const res = await fetch(API_URL+'/orders', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(orderData) });
                localStorage.setItem('user_phone', orderData.custPhone);
                localStorage.setItem('cart', '[]');
                window.location.href = 'orders.html';
            } catch (err) { alert('PROTOCOL UPLOAD FAILED'); }
        });
    }

    // --- BOOKING LOGIC ---
    const bookingForm = document.getElementById('booking-form');
    if (bookingForm) {
        document.querySelectorAll('.time-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                document.querySelectorAll('.time-pill').forEach(p => p.classList.remove('selected'));
                pill.classList.add('selected');
            });
        });
        
        const gCount = document.getElementById('guest-count');
        if (document.getElementById('guest-plus')) {
            document.getElementById('guest-plus').onclick = () => { if(parseInt(gCount.value)<10) gCount.value = parseInt(gCount.value)+1; };
            document.getElementById('guest-minus').onclick = () => { if(parseInt(gCount.value)>1) gCount.value = parseInt(gCount.value)-1; };
        }

        bookingForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const sel = document.querySelector('.time-pill.selected');
            if(!sel) return alert('SECURE A TIME SLOT FIRST!');
            const bData = {
                name: bookingForm.querySelector('input[type="text"]').value,
                phone: bookingForm.querySelector('input[type="tel"]').value,
                date: document.getElementById('booking-date').value,
                timeSlot: sel.dataset.time,
                guests: gCount.value
            };
            try {
                await fetch(API_URL+'/bookings', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(bData) });
                document.getElementById('confirm-modal').style.display='flex';
            } catch(err) { alert('RESERVATION REJECTED'); }
        });
    }
});
