// functions/hello.js
export async function onRequestGet() {
  return new Response("hello", { status: 200 });
}
