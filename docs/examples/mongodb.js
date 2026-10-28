// Fictional Rowfish demo orders for mongosh. Existing rows with these IDs are left unchanged.
/* global db */
const demo = db.getSiblingDB("rowfish_demo");
const orders = demo.getCollection("orders");
const rows = [
  {
    _id: "demo-4101",
    order_id: 4101,
    customer: "Cedar House Supply",
    status: "ready",
    total_usd: 143.2,
    ordered_at: "2026-10-05",
  },
  {
    _id: "demo-4102",
    order_id: 4102,
    customer: "North Loop Workshop",
    status: "processing",
    total_usd: 87.5,
    ordered_at: "2026-10-05",
  },
  {
    _id: "demo-4103",
    order_id: 4103,
    customer: "Quiet Current Works",
    status: "shipped",
    total_usd: 318.4,
    ordered_at: "2026-10-06",
  },
  {
    _id: "demo-4104",
    order_id: 4104,
    customer: "Blue Fern Market",
    status: "ready",
    total_usd: 452.75,
    ordered_at: "2026-10-06",
  },
  {
    _id: "demo-4105",
    order_id: 4105,
    customer: "Juniper Paper Co.",
    status: "processing",
    total_usd: 96.0,
    ordered_at: "2026-10-07",
  },
  {
    _id: "demo-4106",
    order_id: 4106,
    customer: "Copperfield Studio",
    status: "ready",
    total_usd: 1275.25,
    ordered_at: "2026-10-07",
  },
  {
    _id: "demo-4107",
    order_id: 4107,
    customer: "Moss Harbor Goods",
    status: "processing",
    total_usd: 219.0,
    ordered_at: "2026-10-08",
  },
  {
    _id: "demo-4108",
    order_id: 4108,
    customer: "Willow & Finch",
    status: "ready",
    total_usd: 684.5,
    ordered_at: "2026-10-08",
  },
];
for (const row of rows) {
  orders.updateOne({ _id: row._id }, { $setOnInsert: row }, { upsert: true });
}
print(
  `Synthetic demo orders ready in ${demo.getName()}.orders (${rows.length} records).`,
);
