<script setup lang="ts">
import { computed } from "vue";
import { useData, withBase } from "vitepress";

interface Crumb {
  text?: string;
  link?: string;
}

const { frontmatter } = useData();
const crumbs = computed<Crumb[]>(() => {
  const value = frontmatter.value.breadcrumb;
  return Array.isArray(value) ? (value as Crumb[]) : [];
});
</script>

<template>
  <nav v-if="crumbs.length" class="exam-breadcrumb" aria-label="Breadcrumb">
    <template v-for="(crumb, index) in crumbs" :key="index">
      <span v-if="index > 0" class="exam-breadcrumb__sep" aria-hidden="true"
        >/</span
      >
      <a v-if="crumb.link" :href="withBase(crumb.link)">{{ crumb.text }}</a>
      <span v-else aria-current="page">{{ crumb.text }}</span>
    </template>
  </nav>
</template>
