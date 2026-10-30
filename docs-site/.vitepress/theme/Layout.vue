<script setup lang="ts">
import DefaultTheme from "vitepress/theme";
import SnapshotBanner from "./SnapshotBanner.vue";
import Breadcrumbs from "./Breadcrumbs.vue";

const { Layout } = DefaultTheme;
</script>

<template>
  <Layout>
    <template #layout-top><SnapshotBanner /></template>
    <template #doc-before><Breadcrumbs /></template>
  </Layout>
</template>
