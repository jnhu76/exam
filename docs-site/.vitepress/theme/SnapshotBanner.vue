<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useData, withBase } from "vitepress";
import { PRODUCT_SHA_SHORT } from "../../shared/version.mjs";

const { lang } = useData();
const isZh = computed(() => lang.value.toLowerCase().startsWith("zh"));
const applicabilityLink = computed(() =>
  withBase(
    isZh.value
      ? "/zh/standard/capabilities#_1-适用性-applicability"
      : "/standard/capabilities#_1-applicability",
  ),
);

/**
 * OWNERSHIP: VitePress offsets the fixed navbar, sidebar, and content by
 * `--vp-layout-top-height`. A `layout-top` banner must publish its measured
 * height there or it overlaps the navbar. The banner wraps on narrow screens,
 * so the value is measured rather than hard-coded.
 */
const root = ref<HTMLElement | null>(null);
let observer: ResizeObserver | undefined;

function publishHeight(height: number): void {
  document.documentElement.style.setProperty(
    "--vp-layout-top-height",
    `${height}px`,
  );
}

onMounted(() => {
  if (!root.value) return;
  publishHeight(root.value.offsetHeight);
  observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const blockSize =
        entry.borderBoxSize?.[0]?.blockSize ?? entry.target.offsetHeight;
      publishHeight(blockSize);
    }
  });
  observer.observe(root.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  document.documentElement.style.removeProperty("--vp-layout-top-height");
});
</script>

<template>
  <div ref="root" class="exam-snapshot" role="note">
    <div class="exam-snapshot__inner">
      <span class="exam-snapshot__badge">{{
        isZh ? "开发版本快照" : "Development snapshot"
      }}</span>
      <p v-if="isZh">
        本文档描述 master <code>{{ PRODUCT_SHA_SHORT }}</code
        >，即 <code>v0.0.10</code> 发布之后的开发状态，不等同于已发布的
        <code>v0.0.10</code> 契约。
        <a :href="applicabilityLink">查看适用性</a>
      </p>
      <p v-else>
        These docs describe master <code>{{ PRODUCT_SHA_SHORT }}</code
        >, a development state after the <code>v0.0.10</code> release — not the
        published <code>v0.0.10</code> contract.
        <a :href="applicabilityLink">See applicability</a>
      </p>
    </div>
  </div>
</template>
