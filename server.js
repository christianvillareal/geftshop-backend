require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const resend = new Resend(process.env.RESEND_API_KEY);
const app = express();
app.use(cors());
app.use(express.json());
const upload = multer({ dest: 'uploads/' });

// ========== CONFIGURATION ==========
const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY;
const PRODUCTS_BIN_ID = process.env.JSONBIN_BIN_ID;
const PRODUCTS_URL = `https://api.jsonbin.io/v3/b/${PRODUCTS_BIN_ID}`;
const ORDERS_BIN_ID = process.env.ORDER_JSONBIN_BIN_ID;
const ORDERS_URL = `https://api.jsonbin.io/v3/b/${ORDERS_BIN_ID}`;

const readFromBin = async (url, key) => {
  const res = await fetch(url, { headers: { 'X-Master-Key': JSONBIN_API_KEY } });
  if (!res.ok) throw new Error(`JSONBin read failed: ${res.status}`);
  const data = await res.json();
  return data.record?.[key] || [];
};

const writeToBin = async (url, key, data) => {
  const payload = { [key]: data };
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_API_KEY },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`JSONBin write failed: ${res.status} ${errorText}`);
  }
  return res.json();
};

// ========== PRODUCTS ==========
const readProducts = () => readFromBin(PRODUCTS_URL, 'products');
const writeProducts = (products) => writeToBin(PRODUCTS_URL, 'products', products);

const getNextDressCode = async () => {
  const products = await readProducts();
  let max = 1001000;
  for (const p of products) {
    const num = parseInt(p.dressCode, 10);
    if (!isNaN(num) && num > max) max = num;
  }
  return (max + 1).toString();
};

app.get('/api/products', async (req, res) => {
  try {
    const products = await readProducts();
    res.json(products);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const products = await readProducts();
    const product = products.find(p => p.id == req.params.id);
    product ? res.json(product) : res.status(404).json({ error: 'Not found' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

app.post('/api/products', upload.array('images', 8), async (req, res) => {
  try {
    let imageUrls = [];
    if (req.files && req.files.length) {
      for (const file of req.files) {
        // Optimize image on upload: resize to 800px, auto quality, WebP format
        const result = await cloudinary.uploader.upload(file.path, {
          transformation: [
            { width: 800, crop: 'scale' },
            { quality: 'auto' },
            { fetch_format: 'auto' }
          ]
        });
        imageUrls.push(result.secure_url);
        fs.unlinkSync(file.path);
      }
    }
    const products = await readProducts();
    const nextDressCode = await getNextDressCode();
    const newProduct = {
      id: Date.now(),
      name: req.body.name,
      description: req.body.description,
      price: parseFloat(req.body.price),
      color: req.body.color || '',
      size: req.body.size || '',
      stock: parseInt(req.body.stock) || 0,
      dressCode: nextDressCode,
      productWeight: parseFloat(req.body.productWeight) || 0,
      shippingFee: parseFloat(req.body.shippingFee) || 0,
      weightKg: parseFloat(req.body.weightKg) || 0,
      bust: parseFloat(req.body.bust) || 0,
      length: parseFloat(req.body.length) || 0,
      waist: parseFloat(req.body.waist) || 0,
      asianSize: req.body.asianSize || '',
      imageUrls: imageUrls,
    };
    products.push(newProduct);
    await writeProducts(products);
    res.status(201).json(newProduct);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

app.put('/api/products/:id', upload.array('images', 8), async (req, res) => {
  try {
    let products = await readProducts();
    const index = products.findIndex(p => p.id == req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Not found' });
    let keptImageUrls = [];
    if (req.body.existingImages) {
      try { keptImageUrls = JSON.parse(req.body.existingImages); } catch(e) { keptImageUrls = []; }
    }
    let newImageUrls = [];
    if (req.files && req.files.length) {
      for (const file of req.files) {
        // Optimize image on upload
        const result = await cloudinary.uploader.upload(file.path, {
          transformation: [
            { width: 800, crop: 'scale' },
            { quality: 'auto' },
            { fetch_format: 'auto' }
          ]
        });
        newImageUrls.push(result.secure_url);
        fs.unlinkSync(file.path);
      }
    }
    let finalImageUrls = [...keptImageUrls, ...newImageUrls];
    if (finalImageUrls.length > 8) return res.status(400).json({ error: 'Maximum 8 images allowed' });
    const updated = {
      ...products[index],
      ...req.body,
      imageUrls: finalImageUrls,
      price: parseFloat(req.body.price) || products[index].price,
      stock: parseInt(req.body.stock) !== undefined ? parseInt(req.body.stock) : products[index].stock,
    };
    products[index] = updated;
    await writeProducts(products);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Update failed: ' + err.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    let products = await readProducts();
    const newProducts = products.filter(p => p.id != req.params.id);
    if (newProducts.length === products.length) return res.status(404).json({ error: 'Not found' });
    await writeProducts(newProducts);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Delete failed: ' + err.message });
  }
});

// ========== ORDERS ==========
const readOrders = () => readFromBin(ORDERS_URL, 'orders');
const writeOrders = (orders) => writeToBin(ORDERS_URL, 'orders', orders);

app.get('/api/orders', async (req, res) => {
  try {
    const orders = await readOrders();
    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const orders = await readOrders();
    const newOrder = {
      id: Date.now(),
      orderCode: `ORD-${Date.now()}`,
      customer: req.body.customer,
      items: req.body.items,
      total: req.body.total,
      paymentPreference: req.body.paymentPreference,
      status: req.body.status || 'pending',
      createdAt: new Date().toISOString(),
    };
    orders.push(newOrder);
    await writeOrders(orders);

    // Send email to admin
    const adminEmail = process.env.ADMIN_EMAIL || 'your-email@gmail.com';
    const orderItemsHtml = newOrder.items.map(item => `
      <tr><td style="border:1px solid #ddd; padding:8px;">${item.name}</td>
      <td style="border:1px solid #ddd; padding:8px;">${item.dressCode || 'N/A'}</td>
      <td style="border:1px solid #ddd; padding:8px;">₱${item.price.toLocaleString()}</td></tr>
    `).join('');
    try {
      await resend.emails.send({
        from: 'Geftshop <onboarding@resend.dev>',
        to: adminEmail,
        subject: `🛍️ New Order #${newOrder.orderCode}`,
        html: `<h2>New Order Received</h2><p><strong>Order Code:</strong> ${newOrder.orderCode}</p>
               <p><strong>Customer:</strong> ${newOrder.customer.firstName} ${newOrder.customer.lastName}</p>
               <p><strong>Email:</strong> ${newOrder.customer.email}</p>
               <p><strong>Phone:</strong> ${newOrder.customer.phone}</p>
               <p><strong>Address:</strong> ${newOrder.customer.address}</p>
               <p><strong>Payment Preference:</strong> ${newOrder.paymentPreference}</p>
               <h3>Items Ordered:</h3><table style="border-collapse:collapse; width:100%;">${orderItemsHtml}<td>
               <p><strong>Total:</strong> ₱${newOrder.total.toLocaleString()}</p>
               <p><a href="https://geftshop-backend.onrender.com/api/orders">View all orders</a></p>`,
      });
      console.log(`📧 Email sent for order ${newOrder.orderCode}`);
    } catch (emailErr) { console.error('Email error:', emailErr); }

    res.status(201).json(newOrder);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

app.put('/api/orders/:id', async (req, res) => {
  try {
    let orders = await readOrders();
    const id = parseInt(req.params.id);
    const index = orders.findIndex(o => o.id === id);
    if (index === -1) return res.status(404).json({ error: 'Order not found' });
    orders[index] = { ...orders[index], ...req.body };
    await writeOrders(orders);
    res.json(orders[index]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  try {
    let orders = await readOrders();
    const id = parseInt(req.params.id);
    const newOrders = orders.filter(o => o.id !== id);
    if (newOrders.length === orders.length) return res.status(404).json({ error: 'Order not found' });
    await writeOrders(newOrders);
    res.json({ message: 'Order deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete order' });
  }
});

// ========== CONTACT FORM ==========
app.post('/api/contact', async (req, res) => {
  const { user_name, user_email, subject, message } = req.body;
  if (!user_name || !user_email || !subject || !message) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const adminEmail = process.env.ADMIN_EMAIL || 'your-email@gmail.com';
  try {
    await resend.emails.send({
      from: 'Geftshop Contact <onboarding@resend.dev>',
      to: adminEmail,
      replyTo: user_email,
      subject: `📬 Contact Form: ${subject}`,
      html: `<h2>New Contact Form Submission</h2>
             <p><strong>Name:</strong> ${user_name}</p>
             <p><strong>Email:</strong> ${user_email}</p>
             <p><strong>Subject:</strong> ${subject}</p>
             <p><strong>Message:</strong></p>
             <p>${message.replace(/\n/g, '<br/>')}</p>`,
    });
    res.status(200).json({ message: 'Email sent successfully' });
  } catch (err) {
    console.error('Contact email error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// ========== ROOT ==========
app.get('/', (req, res) => {
  res.send('Geftshop API is running. Visit /api/products, /api/orders, or /api/contact');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));