"use client";

import type { NextPage } from "next";
import { AdminPanel } from "~~/components/AdminPanel";

const AdminPage: NextPage = () => {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Admin</h1>
        <p className="mt-2 text-sm opacity-70">Owner-only controls for RWA operations.</p>
      </div>
      <AdminPanel />
    </div>
  );
};

export default AdminPage;
