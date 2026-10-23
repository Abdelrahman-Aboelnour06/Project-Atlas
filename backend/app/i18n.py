"""
Universal i18n & Language Resolution Engine
backend/app/i18n.py

Provides:
- resolve_reply_language(selected, user_text): Resolves target language locale ('ar-EG' | 'en-US').
  Arabic selection forces 'ar-EG'; otherwise script mirroring (Arabic text -> 'ar-EG', Latin -> 'en-US').
- t(key, lang, **kwargs): Universal bilingual string table lookup with Egyptian colloquial Arabic
  and byte-for-byte exact English preservation.
- is_mostly_non_arabic(text): Heuristic to detect if a reply intended to be Arabic has < 30% Arabic characters.

Adheres strictly to the Prime Directive: 100% universal across all websites, zero site or domain names.
"""

import re
from typing import Any, Dict, Optional

# Universal string table for English and Egyptian Colloquial Arabic (ar-EG)
STRINGS: Dict[str, Dict[str, str]] = {
    "en": {
        # Search actions
        "search_typing_reply": "Typing '{query}' into search for you now!",
        "search_typing_success": "Searched for '{query}'.",
        "search_focus_reply": "I've focused the search bar for you!",
        "search_focus_success": "Focused search bar.",
        "search_focus_step_desc": "Click search bar to focus",
        "search_submit_step_desc": "Click search button",
        "search_fill_step_desc": "Type '{query}' into search",

        # Canonical / Heuristic actions
        "canonical_open_reply": "I found '{lbl}' on the page. Double click '{lbl}' for you now!",
        "canonical_open_desc": "Double click '{lbl}'",
        "canonical_open_success": "Done! Completed Double click '{lbl}'.",

        "canonical_triple_click_reply": "I found '{lbl}' on the page. Triple click '{lbl}' for you now!",
        "canonical_triple_click_desc": "Triple click '{lbl}'",
        "canonical_triple_click_success": "Done! Completed Triple click '{lbl}'.",

        "canonical_multi_click_reply": "I found '{lbl}' on the page. Click '{lbl}' {click_count} times for you now!",
        "canonical_multi_click_desc": "Click '{lbl}' {click_count} times",
        "canonical_multi_click_success": "Done! Completed Click '{lbl}' {click_count} times.",

        "canonical_single_click_reply": "I found '{lbl}' on the page. Click '{lbl}' for you now!",
        "canonical_single_click_desc": "Click '{lbl}'",
        "canonical_single_click_success": "Done! Completed Click '{lbl}'.",

        "selected_item_default": "the selected item",
        "request_processed": "I've processed your request.",
        "action_completed": "Done! Action completed.",

        # Confirmations
        "confirm_proceed_option": "Yes, proceed",
        "confirm_cancel_option": "No, cancel",
        "confirm_with_node": "Great! Confirming and completing that for you now.",
        "confirm_understood": "Understood! Confirmed.",
        "cancel_no_problem": "No problem, I've cancelled that for you.",

        # Page Inquiries
        "page_inquiry_domain": "I see the {domain} page.",
        "page_inquiry_webpage": "I see the current webpage.",
        "page_inquiry_nav": "In navigation, you have {items}.",
        "page_inquiry_folders": "Folders include '{items}'.",
        "page_inquiry_files": "Files visible include {items}.",
        "page_inquiry_search": "There is a search box ({input_name}).",
        "page_inquiry_actions": "Actions you can take include '{items}'.",
        "page_inquiry_snippet": "I see this webpage: {snippet}...",
        "page_inquiry_fallback": "I'm viewing this page. Tell me what you'd like to click, search for, or open!",

        # Errors / Fallbacks in planner
        "llm_auth_error_401": "The AI service returned an authentication error (401). Please configure your LLM_API_KEY in backend/.env. In the meantime, you can ask me to click or open buttons visible on this page (e.g. 'timetable', 'registration')!",
        "no_match_with_samples": "I reviewed the page, but couldn't find an element matching '{user_message}'. On this screen, you can click items like '{samples}', or tell me what to search for.",
        "no_match_without_samples": "I couldn't locate '{user_message}' on this page. You can tell me to click any visible button, scroll, or fill in a search box.",

        # Routes / Chat / QA / Summary
        "qa_not_sure": "I'm not sure about that based on this page, but you can try searching or clicking an item from the Elements tab.",
        "ai_service_trouble": "I am having trouble reaching the AI service right now. Please try again shortly.",
        "unexpected_issue": "Sorry, I encountered an unexpected issue while processing your question.",
        "summary_fallback": "Welcome to this webpage. You can browse, search, or tell me what to click.",
        "summary_fallback_domain": "This is {domain}. You can search, browse content, or ask Atlas to navigate elements on this page.",

        # Goal step replies
        "hop_limit_reached": "Goal execution stopped: reached maximum allowed hops limit ({max_hops}).",
        "handoff_limit_reached": "Goal execution stopped: reached maximum allowed tab handoffs ({max_handoffs}).",
        "already_terminated": "Goal execution already terminated.",
        "action_cancelled_next": "Action cancelled. What would you like to do next?",
        "confirmation_received_executing": "Confirmation received. Executing confirmed step now.",
        "popup_blocked_prompt": "Browser popup was blocked. Please click the button to open the window.",
        "cross_origin_detected": "Notice: Cross-origin window detected on {host}. Do you want to proceed?",
        "child_tab_closed_returning": "Child popup workflow complete. Closing child tab and returning to opener tab.",
        "goal_completed_success": "Goal completed successfully!",
        "goal_completed_all_milestones": "Goal completed successfully! All milestones finished.",
        "goal_completed_result": "Goal completed successfully! {result}",
        "child_tab_milestone_complete": "Child tab milestone complete. Closing child tab and returning to opener tab.",
        "goal_failed_with_reason": "Goal failed: {reason}",
        "captcha_detected_prompt": "A CAPTCHA challenge was detected. Please solve it in the browser to continue.",
        "captcha_detected_reply": "A CAPTCHA challenge was detected. Please solve it to continue.",
        "otp_required_prompt": "A one-time verification code (OTP) is required. Please provide it to continue.",
        "otp_required_reply": "A one-time verification code (OTP) is required. Please provide it to continue.",
        "captcha_form_prompt": "A CAPTCHA challenge was detected in the form. Please solve it to continue.",
        "captcha_form_reply": "A CAPTCHA challenge was detected in the form. Please solve it to continue.",
        "otp_form_prompt": "A one-time verification code (OTP) is required. Please enter it to continue.",
        "otp_form_reply": "A one-time verification code (OTP) is required. Please enter it to continue.",
        "max_hops_fallback": "Reached maximum hops limit.",
        "batch_form_fill_prepared": "Prepared batch form fill for {count} fields.",
        "form_missing_fields_prompt": "Please provide {fields} to proceed.",
        "form_validation_error_reask": "Please check and re-enter a valid {field}.",
        "form_validation_failed_max_attempts": "Failed to validate {field} after multiple attempts. Stopping goal execution.",
        "form_confirm_submit": "Ready to submit the form. Do you want to proceed?",

        # Navigator
        "nav_cancelled_action": "No problem, I've cancelled that action for you.",
        "nav_interacting_with": "Interacting with {label}.",
        "nav_heuristic_found": "I found '{lbl}' on the page. Clicking '{lbl}' for you now.",
        "nav_confirm_sensitive": "This action will {desc}. Would you like to proceed?",
        "nav_confirm_generic": "Would you like to proceed with this action?",
        "nav_confirm_desc": "Would you like to confirm: {desc}?",

        # Exploration & Navigation (WS6)
        "nav_max_hops_tried": "I couldn't reach the requested service within the step limit. Here is what I tried: {tried}",
        "nav_exploration_exhausted": "I reviewed the available options, but couldn't find the requested service. Here is what I tried: {tried}",
        "nav_deadend_backtrack": "Reached a dead-end on this page. Backtracking to explore other navigation options.",
        "nav_exploring_menu": "Opening menu '{toggle}' to check for {target}.",
        "nav_search_query": "Searching the site for '{query}'.",

        # Router & Loop (WS5)
        "router_goal_ack": "I'm on it! Starting to work towards your goal: '{goal}'",
        "loop_repeated_action_limit": "Goal execution stopped: the same action on element '{element}' was repeated 3 times without progress.",
    },
    "ar-EG": {
        # Search actions
        "search_typing_reply": "بكتب '{query}' في البحث دلوقتي علشانك!",
        "search_typing_success": "تم البحث عن '{query}'.",
        "search_focus_reply": "فتحت لك شريط البحث دلوقتي!",
        "search_focus_success": "تم تفعيل شريط البحث.",
        "search_focus_step_desc": "الضغط على شريط البحث لتفعيله",
        "search_submit_step_desc": "الضغط على زر البحث",
        "search_fill_step_desc": "كتابة '{query}' في البحث",

        # Canonical / Heuristic actions
        "canonical_open_reply": "لقيت '{lbl}' في الصفحة. هفتحها لك دلوقتي!",
        "canonical_open_desc": "فتح '{lbl}'",
        "canonical_open_success": "تم! فتحت '{lbl}'.",

        "canonical_triple_click_reply": "لقيت '{lbl}' في الصفحة. هضغط عليها 3 مرات دلوقتي!",
        "canonical_triple_click_desc": "الضغط 3 مرات على '{lbl}'",
        "canonical_triple_click_success": "تم! تم الضغط 3 مرات على '{lbl}'.",

        "canonical_multi_click_reply": "لقيت '{lbl}' في الصفحة. هضغط عليها {click_count} مرات دلوقتي!",
        "canonical_multi_click_desc": "الضغط على '{lbl}' {click_count} مرات",
        "canonical_multi_click_success": "تم! تم الضغط على '{lbl}' {click_count} مرات.",

        "canonical_single_click_reply": "لقيت '{lbl}' في الصفحة. هضغط عليها دلوقتي!",
        "canonical_single_click_desc": "الضغط على '{lbl}'",
        "canonical_single_click_success": "تمام! ضغطت على '{lbl}'.",

        "selected_item_default": "العنصر المختار",
        "request_processed": "نفذت طلبك.",
        "action_completed": "تم! العملية اكتملت.",

        # Confirmations
        "confirm_proceed_option": "أيوة، كمل",
        "confirm_cancel_option": "لا، إلغي",
        "confirm_with_node": "تمام! بأكد وبكمل لك ده دلوقتي.",
        "confirm_understood": "مفهوم! تم التأكيد.",
        "cancel_no_problem": "ولا يهمك، لغيت ده علشانك.",

        # Page Inquiries
        "page_inquiry_domain": "أنا شايف صفحة {domain}.",
        "page_inquiry_webpage": "أنا شايف الصفحة الحالية.",
        "page_inquiry_nav": "في شريط التنقل، عندك {items}.",
        "page_inquiry_folders": "المجلدات الموجودة فيها '{items}'.",
        "page_inquiry_files": "الملفات الظاهرة تشمل {items}.",
        "page_inquiry_search": "فيه مربع بحث ({input_name}).",
        "page_inquiry_actions": "العمليات المتاحة تشمل '{items}'.",
        "page_inquiry_snippet": "أنا شايف الصفحة دي: {snippet}...",
        "page_inquiry_fallback": "أنا متابع الصفحة دي. قولي تحب تضغط على إيه، تبحث عن إيه، أو تفتح إيه!",

        # Errors / Fallbacks in planner
        "llm_auth_error_401": "خدمة الذكاء الاصطناعي رجعت خطأ في المصادقة (401). يرجى ضبط LLM_API_KEY في backend/.env. في الوقت الحالي، تقدر تطلب مني الضغط على أو فتح الأزرار الظاهرة في الصفحة!",
        "no_match_with_samples": "راجعت الصفحة، بس ملقتش عنصر يطابق '{user_message}'. في الشاشة دي، تقدر تضغط على عناصر زي '{samples}'، أو تقولي تبحث عن إيه.",
        "no_match_without_samples": "ملقتش '{user_message}' في الصفحة دي. تقدر تقولي اضغط على أي زرار ظاهر، أنزل في الصفحة، أو أكتب في مربع البحث.",

        # Routes / Chat / QA / Summary
        "qa_not_sure": "مش متأكد من ده بناءً على الصفحة دي، بس تقدر تجرب تبحث أو تضغط على عنصر من قائمة العناصر.",
        "ai_service_trouble": "عندي مشكلة في الاتصال بخدمة الذكاء الاصطناعي دلوقتي. جرب كمان شوية.",
        "unexpected_issue": "معلش، واجهت مشكلة غير متوقعة أثناء معالجة سؤالك.",
        "summary_fallback": "أهلاً بيك في الصفحة دي. تقدر تتصفح، تبحث، أو تقولي اضغط على إيه.",
        "summary_fallback_domain": "دي صفحة {domain}. تقدر تبحث، تتصفح المحتوى، أو تطلب من أطلس التنقل بين عناصر الصفحة.",

        # Goal step replies
        "hop_limit_reached": "تم إيقاف تنفيذ الهدف: تم الوصول للحد الأقصى للخطوات ({max_hops}).",
        "handoff_limit_reached": "تم إيقاف تنفيذ الهدف: تم الوصول للحد الأقصى للتنقل بين التبويبات ({max_handoffs}).",
        "already_terminated": "تنفيذ الهدف منتهي بالفعل.",
        "action_cancelled_next": "تم إلغاء العملية. تحب نعمل إيه بعد كده؟",
        "confirmation_received_executing": "تم استلام التأكيد. جاري تنفيذ الخطوة المؤكدة دلوقتي.",
        "popup_blocked_prompt": "المتصفح منع فتح النافذة المنبثقة. يرجى الضغط على الزر لفتح النافذة.",
        "cross_origin_detected": "تنبيه: تم رصد نافذة من نطاق مختلف على {host}. تحب تكمل؟",
        "child_tab_closed_returning": "تم اكتمال مسار النافذة المنبثقة. جاري إغلاق التبويب والرجوع للتبويب الرئيسي.",
        "goal_completed_success": "تم اكتمال الهدف بنجاح!",
        "goal_completed_all_milestones": "تم اكتمال الهدف بنجاح! اكتملت كل المراحل.",
        "goal_completed_result": "تم اكتمال الهدف بنجاح! {result}",
        "child_tab_milestone_complete": "اكتملت مرحلة التبويب الفرعي. جاري إغلاق التبويب والرجوع للتبويب الرئيسي.",
        "goal_failed_with_reason": "فشل الهدف: {reason}",
        "captcha_detected_prompt": "تم رصد اختبار كابتشا (CAPTCHA). يرجى حله في المتصفح للمتابعة.",
        "captcha_detected_reply": "تم رصد اختبار كابتشا (CAPTCHA). يرجى حله للمتابعة.",
        "otp_required_prompt": "مطلوب رمز تحقق لمرة واحدة (OTP). يرجى إدخاله للمتابعة.",
        "otp_required_reply": "مطلوب رمز تحقق لمرة واحدة (OTP). يرجى إدخاله للمتابعة.",
        "captcha_form_prompt": "تم رصد اختبار كابتشا (CAPTCHA) في النموذج. يرجى حله للمتابعة.",
        "captcha_form_reply": "تم رصد اختبار كابتشا (CAPTCHA) في النموذج. يرجى حله للمتابعة.",
        "otp_form_prompt": "مطلوب رمز تحقق لمرة واحدة (OTP). يرجى إدخاله للمتابعة.",
        "otp_form_reply": "مطلوب رمز تحقق لمرة واحدة (OTP). يرجى إدخاله للمتابعة.",
        "max_hops_fallback": "تم الوصول للحد الأقصى للخطوات.",
        "batch_form_fill_prepared": "تم تجهيز ملء {count} حقول في النموذج.",
        "form_missing_fields_prompt": "محتاج {fields} للمتابعة.",
        "form_validation_error_reask": "يرجى التأكد من صحة {field} وإعادة إدخاله.",
        "form_validation_failed_max_attempts": "تعذر التحقق من صحة {field} بعد عدة محاولات. تم إيقاف تنفيذ الهدف.",
        "form_confirm_submit": "جاهز لإرسال النموذج. تحب تكمل؟",

        # Navigator
        "nav_cancelled_action": "ولا يهمك، لغيت العملية دي علشانك.",
        "nav_interacting_with": "جاري التفاعل مع {label}.",
        "nav_heuristic_found": "لقيت '{lbl}' في الصفحة. هضغط على '{lbl}' علشانك دلوقتي.",
        "nav_confirm_sensitive": "العملية دي هتقوم بـ {desc}. تحب تكمل؟",
        "nav_confirm_generic": "تحب تكمل العملية دي؟",
        "nav_confirm_desc": "تحب تأكد: {desc}؟",

        # Exploration & Navigation (WS6)
        "nav_max_hops_tried": "معرفتش أوصل للخدمة المطلوبة خلال الحد الأقصى للخطوات. وده اللي جربت أعمله: {tried}",
        "nav_exploration_exhausted": "معرفتش ألاقي الخدمة المطلوبة في الموقع ده. وده اللي جربت أعمله: {tried}",
        "nav_deadend_backtrack": "وصلت لطريق مسدود في الصفحة دي. برجع علشان أجرب خيارات تانية.",
        "nav_exploring_menu": "بفتح قائمة '{toggle}' علشان أشوف {target}.",
        "nav_search_query": "ببحث في الموقع عن '{query}'.",

        # Router & Loop (WS5)
        "router_goal_ack": "تمام، جاري العمل على تحقيق هدفك: '{goal}'",
        "loop_repeated_action_limit": "تم إيقاف تنفيذ الهدف: تكرر نفس الإجراء على العنصر '{element}' 3 مرات دون تقدم.",
    },
}


def resolve_reply_language(selected: Optional[str], user_text: Optional[str]) -> str:
    """
    Resolves target reply language locale ('ar-EG' | 'en-US').

    Rule:
    - If `selected` starts with 'ar' (e.g. 'ar', 'ar-EG'), return 'ar-EG'.
    - If `selected` starts with 'en' (e.g. 'en', 'en-US'):
      - return 'ar-EG' if user_text contains Arabic letters ([\u0600-\u06FF]).
      - otherwise 'en-US'.
    - Mirroring by user script when `selected` is None or empty:
      - If user_text contains Arabic characters ([\u0600-\u06FF]), return 'ar-EG'.
      - Otherwise, return 'en-US'.
    """
    has_arabic = bool(user_text and re.search(r"[\u0600-\u06FF]", str(user_text)))

    if selected:
        s = str(selected).strip().lower()
        if s.startswith("ar"):
            return "ar-EG"
        if s.startswith("en"):
            return "ar-EG" if has_arabic else "en-US"

    return "ar-EG" if has_arabic else "en-US"


def is_mostly_non_arabic(text: Optional[str]) -> bool:
    """
    Checks if a text expected to be Arabic consists mostly of Latin or non-Arabic letters.
    Returns True when total alphabetical letters > 0 and Arabic letters make up < 30%.
    """
    if not text:
        return False
    arabic_count = len(re.findall(r"[\u0600-\u06FF]", text))
    latin_count = len(re.findall(r"[a-zA-Z]", text))
    total_letters = arabic_count + latin_count
    if total_letters == 0:
        return False
    return (arabic_count / total_letters) < 0.30


def t(key: str, lang: Optional[str] = None, **kwargs: Any) -> str:
    """
    Universal string table lookup with keyword formatting.
    Falls back gracefully to English template, then to the key itself.
    """
    target_lang = "ar-EG" if (lang and str(lang).strip().lower().startswith("ar")) else "en"
    table = STRINGS.get(target_lang, STRINGS["en"])
    template = table.get(key) or STRINGS["en"].get(key, key)

    if not kwargs:
        res = template
    else:
        if target_lang == "ar-EG" and key == "goal_failed_with_reason":
            raw_reason = kwargs.get("reason", "")
            if raw_reason and bool(re.search(r"[a-zA-Z]", str(raw_reason))):
                # When English reason leaks in Arabic mode, replace with generic Arabic message (L5)
                kwargs["reason"] = "تعذر إكمال الخطوة المطلوبة بعد عدة محاولات"
        try:
            res = template.format(**kwargs)
        except Exception:
            res = template

    if target_lang == "ar-EG":
        # Ensure zero unquoted Latin characters leak into Arabic user replies (L5)
        pattern = r'(\"[^\"]*\"|\'[^\']*\'|«[^»]*»|“[^”]*”)|([a-zA-Z]+)'
        res = re.sub(pattern, lambda m: m.group(1) if m.group(1) else "", res)
        res = re.sub(r"\s+", " ", res).strip()

    return res

