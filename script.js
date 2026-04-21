// ========================================================
// PIZZA & BURGER HUB - PRODUCTION FRONTEND LOGIC
// Handles network failures, retries, and smooth UX
// ========================================================

// Auto-detect API URL (works on localhost AND production)
const API_URL = window.location.origin + '/api';

// Single socket.io connection (reusable across pages)
const socket = io(window.location.origin, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000
});

// Connection status tracking
socket.on('connect', () => {
    console.log('✅ Connected to server');
    document.body.classList.remove('offline');
});

socket.on('disconnect', () => {
    console.log('⚠️ Disconnected from server');
    document.body.classList.add('offline');
});

// ---------------------------------------------------
// GLOBAL UTILITIES
// ---------------------------------------------------

// Smart fetch with retry
async function apiFetch(url, options = {}, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...(options.headers || {})
                }
            });
            
            if (res.status === 429) {
                // Rate limited - wait and retry
                showToast('Thoda ruko bhai, bohot zyada requests! 🚦', 'warning');
                await new Promise(r => setTimeout(r, 3000));
                continue;
            }
            
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.message || `Server error (${res.status})`);
            }
            
            return await res.json();
        } catch (err) {
            if (attempt === retries) {
                throw err;
            }
            console.warn(`⚠️ Attempt ${attempt} failed, retrying...`);
            await new Promise(r => setTimeout(r, 1000 * attempt)); // exponential backoff
        }
    }
}

// Toast notification system
window.showToast = (message, type = 'success') => {
    // Remove existing toasts to prevent stacking
    document.querySelectorAll('.toast').forEach(t => t.remove());
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    
    toast.innerHTML = `<i class="fas ${icons[type] || icons.success}"></i> ${message}`;
    document.body.appendChild(toast);
    
    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 500);
    }, 4000);
};

// ---------------------------------------------------
// CART SYSTEM (localStorage based)
// ---------------------------------------------------
function getCart() {
    try {
        return JSON.parse(localStorage.getItem('cart')) || [];
    } catch {
        localStorage.setItem('cart', '[]');
        return [];
    }
}

function setCart(cart) {
    localStorage.setItem('cart', JSON.stringify(cart));
}

function attachCartListeners() {
    document.querySelectorAll('.add-to-cart').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const item = {
                id: newBtn.dataset.id,
                name: newBtn.dataset.name,
                price: parseFloat(newBtn.dataset.price),
                qty: 1
            };
            
            if (!item.id || !item.name || isNaN(item.price)) {
                showToast('Invalid item data!', 'error');
                return;
            }
            
            let cart = getCart();
            const existing = cart.find(i => i.id === item.id);
            
            if (existing) {
                if (existing.qty >= 50) {
                    showToast('Maximum 50 hi add kar sakte ho ek item ke!', 'warning');
                    return;
                }
                existing.qty += 1;
            } else {
                cart.push(item);
            }
            
            setCart(cart);
            window.updateCartUI();
            
            // Add button animation
            newBtn.style.transform = 'scale(0.9)';
            setTimeout(() => newBtn.style.transform = '', 200);
            
            showToast(`${item.name} cart mein add ho gaya! 🛒`);
        });
    });
}

// ---------------------------------------------------
// MAIN DOM READY
// ---------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {

    window.updateCartUI = function() {
        const cart = getCart();
        const countSpan = document.getElementById('cart-count');
        const listContainer = document.getElementById('cart-items-list');
        const subtotalSpan = document.getElementById('subtotal');
        const totalSpan = document.getElementById('total-price');

        if (countSpan) countSpan.innerText = cart.reduce((acc, i) => acc + i.qty, 0);

        if (listContainer) {
            if (cart.length === 0) {
                listContainer.innerHTML = '<p style="opacity:0.3; text-align:center; padding:20px;">Khaali hai! Kuch masaledaar add karein 🍕</p>';
            } else {
                listContainer.innerHTML = cart.map(item => `
                    <div class="cart-item-luxury">
                        <div>
                            <h5 style="font-size:0.9rem;">${item.name}</h5>
                            <div style="display:flex; align-items:center; gap:8px; margin-top:5px;">
                                <button class="qty-btn qty-minus" data-id="${item.id}" style="width:24px; height:24px; border-radius:50%; border:1px solid rgba(255,255,255,0.2); background:transparent; color:white; cursor:pointer; font-size:0.7rem;">−</button>
                                <span style="font-size:0.8rem; font-weight:600; min-width:20px; text-align:center;">${item.qty}</span>
                                <button class="qty-btn qty-plus" data-id="${item.id}" style="width:24px; height:24px; border-radius:50%; border:1px solid rgba(255,255,255,0.2); background:transparent; color:white; cursor:pointer; font-size:0.7rem;">+</button>
                            </div>
                        </div>
                        <div style="display:flex; align-items:center; gap:15px;">
                            <span style="font-weight:700;">₹${item.price * item.qty}</span>
                            <i class="fas fa-times remove-item" style="cursor:pointer; color:var(--primary-crimson); font-size:0.8rem;" data-id="${item.id}"></i>
                        </div>
                    </div>
                `).join('');

                // Quantity buttons
                document.querySelectorAll('.qty-minus').forEach(btn => {
                    btn.addEventListener('click', () => {
                        let currentCart = getCart();
                        const item = currentCart.find(i => i.id === btn.dataset.id);
                        if (item) {
                            if (item.qty <= 1) {
                                currentCart = currentCart.filter(i => i.id !== btn.dataset.id);
                            } else {
                                item.qty -= 1;
                            }
                            setCart(currentCart);
                            window.updateCartUI();
                        }
                    });
                });

                document.querySelectorAll('.qty-plus').forEach(btn => {
                    btn.addEventListener('click', () => {
                        let currentCart = getCart();
                        const item = currentCart.find(i => i.id === btn.dataset.id);
                        if (item && item.qty < 50) {
                            item.qty += 1;
                            setCart(currentCart);
                            window.updateCartUI();
                        }
                    });
                });

                // Remove item
                document.querySelectorAll('.remove-item').forEach(trash => {
                    trash.addEventListener('click', () => {
                        let currentCart = getCart();
                        currentCart = currentCart.filter(i => i.id !== trash.dataset.id);
                        setCart(currentCart);
                        window.updateCartUI();
                        showToast('Item remove ho gaya', 'info');
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
                const cart = getCart();
                if (cart.length === 0) {
                    showToast('Cart khaali hai! Pehle kuch add karo 🍔', 'warning');
                    return;
                }
                document.getElementById('checkout-modal-overlay').style.display = 'flex';
            });
        }

        orderForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const submitBtn = orderForm.querySelector('button[type="submit"]');
            const originalText = submitBtn.innerText;
            
            // Prevent double submit
            if (submitBtn.disabled) return;
            submitBtn.disabled = true;
            submitBtn.innerText = 'Placing Order...';
            submitBtn.style.opacity = '0.6';
            
            const currentCart = getCart();
            if (currentCart.length === 0) {
                showToast('Cart khaali hai!', 'error');
                submitBtn.disabled = false;
                submitBtn.innerText = originalText;
                submitBtn.style.opacity = '1';
                return;
            }

            const orderData = {
                custName: document.getElementById('cust-name').value.trim(),
                custPhone: document.getElementById('cust-phone').value.trim(),
                custAddress: document.getElementById('cust-address').value.trim(),
                type: document.getElementById('cust-type').value,
                items: currentCart,
                total: currentCart.reduce((acc, i) => acc + (i.price * i.qty), 0) + 
                       (document.getElementById('cust-type').value === 'delivery' ? 40 : 0)
            };

            // Client-side validation
            if (orderData.custName.length < 2) {
                showToast('Name kamse kam 2 characters ka hona chahiye', 'error');
                submitBtn.disabled = false;
                submitBtn.innerText = originalText;
                submitBtn.style.opacity = '1';
                return;
            }
            if (!/^[0-9]{10,13}$/.test(orderData.custPhone.replace(/\s/g, ''))) {
                showToast('Valid phone number daaliye (10-13 digits)', 'error');
                submitBtn.disabled = false;
                submitBtn.innerText = originalText;
                submitBtn.style.opacity = '1';
                return;
            }

            try {
                const result = await apiFetch(API_URL + '/orders', {
                    method: 'POST',
                    body: JSON.stringify(orderData)
                });
                
                if (result.success) {
                    localStorage.setItem('user_phone', orderData.custPhone);
                    setCart([]);
                    showToast('🎉 Order successfully place ho gaya!');
                    setTimeout(() => {
                        window.location.href = 'orders.html';
                    }, 1000);
                } else {
                    showToast(result.message || 'Order nahi lag paaya', 'error');
                    submitBtn.disabled = false;
                    submitBtn.innerText = originalText;
                    submitBtn.style.opacity = '1';
                }
            } catch (err) {
                showToast(err.message || 'Network error! Internet check karo', 'error');
                submitBtn.disabled = false;
                submitBtn.innerText = originalText;
                submitBtn.style.opacity = '1';
            }
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
            document.getElementById('guest-plus').onclick = () => { if(parseInt(gCount.value)<20) gCount.value = parseInt(gCount.value)+1; };
            document.getElementById('guest-minus').onclick = () => { if(parseInt(gCount.value)>1) gCount.value = parseInt(gCount.value)-1; };
        }

        bookingForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const sel = document.querySelector('.time-pill.selected');
            if (!sel) {
                showToast('Pehle time slot select karo!', 'warning');
                return;
            }
            
            const submitBtn = bookingForm.querySelector('button[type="submit"]');
            const originalText = submitBtn.innerText;
            submitBtn.disabled = true;
            submitBtn.innerText = 'Booking...';
            
            const bData = {
                name: bookingForm.querySelector('input[type="text"]').value.trim(),
                phone: bookingForm.querySelector('input[type="tel"]').value.trim(),
                date: document.getElementById('booking-date').value,
                timeSlot: sel.dataset.time,
                guests: parseInt(gCount.value)
            };

            try {
                const result = await apiFetch(API_URL + '/bookings', {
                    method: 'POST',
                    body: JSON.stringify(bData)
                });
                
                if (result.success) {
                    document.getElementById('confirm-modal').style.display = 'flex';
                } else {
                    showToast(result.message || 'Booking nahi ho paayi', 'error');
                }
            } catch (err) {
                showToast(err.message || 'Network error!', 'error');
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerText = originalText;
            }
        });
    }

    // --- SCROLL REVEAL ANIMATION INJECTION ---
    const revealElements = document.querySelectorAll('.glass-card, section h2, .section-padding p, footer .logo');
    revealElements.forEach((el, index) => {
        el.classList.add('reveal-up');
        if (index % 3 === 1) el.classList.add('reveal-delay-1');
        if (index % 3 === 2) el.classList.add('reveal-delay-2');
    });

    const revealOptions = {
        threshold: 0.15,
        rootMargin: "0px 0px -50px 0px"
    };

    const revealOnScroll = new IntersectionObserver(function(entries, observer) {
        entries.forEach(entry => {
            if (!entry.isIntersecting) {
                return;
            } else {
                entry.target.classList.add('reveal-active');
                observer.unobserve(entry.target);
            }
        });
    }, revealOptions);

    document.querySelectorAll('.reveal-up').forEach(el => revealOnScroll.observe(el));
});
