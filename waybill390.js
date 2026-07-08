const target='waybill.html'+location.search;
if(window.frame){
  frame.src=target;
}else{
  location.replace(target);
}
